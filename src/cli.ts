#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { indexProject, KnowledgeBase } from './indexer/index.js';
import { logger } from './utils/logger.js';
import {
  search,
  getStats,
  formatStatsTable,
  getDependencies,
  formatDepsTree,
  find,
  exportSymbols,
  formatMarkdown,
  generateContext,
  formatContextMarkdown,
  type SearchableKind,
  type DependencyDirection,
} from './query/index.js';

const program = new Command();

program
  .name('codebase-knowledge-extractor')
  .description('Creates a queryable knowledge base from codebases')
  .version('0.1.0');

program
  .command('index')
  .description('Index a codebase to create a knowledge base')
  .argument('<path>', 'Path to the project to index')
  .requiredOption('--name <name>', 'Name for the knowledge base')
  .option('--data-dir <dir>', 'Directory to store the knowledge base', 'data')
  .option('--exclude <pattern>', 'Glob pattern to exclude (can be specified multiple times)', (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (projectPath: string, options: { name: string; dataDir: string; exclude: string[]; verbose?: boolean }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const absolutePath = resolve(projectPath);
      const dataDir = resolve(options.dataDir);

      const result = await indexProject(absolutePath, {
        projectName: options.name,
        dataDir,
        excludePatterns: options.exclude,
      });

      console.log(`\nIndexing complete!`);
      console.log(`  Project: ${result.projectName}`);
      console.log(`  Files: ${result.fileCount}`);
      console.log(`  Symbols: ${result.symbolCount}`);
      console.log(`  Output: ${result.outputPath}`);
    } catch (err) {
      logger.error(`Failed to index project: ${err}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List indexed files in a knowledge base')
  .argument('<name>', 'Name of the knowledge base')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (name: string, options: { dataDir: string }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const meta = await kb.readMeta();
      const files = await kb.listIndexedFiles();

      console.log(`\nKnowledge Base: ${name}`);
      console.log(`  Root: ${meta?.rootPath}`);
      console.log(`  Indexed: ${meta?.indexedAt}`);
      console.log(`  Files: ${meta?.fileCount}`);
      console.log(`  Symbols: ${meta?.symbolCount}`);
      console.log(`\nIndexed files:`);

      for (const file of files) {
        console.log(`  ${file.relativePath} (${file.symbolCount} symbols)`);
      }
    } catch (err) {
      logger.error(`Failed to list files: ${err}`);
      process.exit(1);
    }
  });

program
  .command('projects')
  .description('List all indexed projects')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (options: { dataDir: string }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const projects = await KnowledgeBase.listProjects(dataDir);

      if (projects.length === 0) {
        console.log('No indexed projects found.');
        return;
      }

      console.log('\nIndexed projects:');
      for (const project of projects) {
        const kb = new KnowledgeBase(dataDir, project);
        const meta = await kb.readMeta();
        if (meta) {
          console.log(`  ${project} - ${meta.fileCount} files, ${meta.symbolCount} symbols`);
        } else {
          console.log(`  ${project} - (metadata unavailable)`);
        }
      }
    } catch (err) {
      logger.error(`Failed to list projects: ${err}`);
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search for symbols by name, member, or signature')
  .argument('<term>', 'Search term')
  .requiredOption('--name <kb>', 'Knowledge base name')
  .option('--kind <type>', 'Filter by symbol kind (class|interface|struct|enum|method|property|field)')
  .option('--namespace <prefix>', 'Filter by namespace prefix')
  .option('--limit <n>', 'Maximum results', '50')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (term: string, options: {
    name: string;
    kind?: string;
    namespace?: string;
    limit: string;
    dataDir: string;
  }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, options.name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${options.name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const result = await search(kb, term, {
        kind: options.kind as SearchableKind | undefined,
        namespace: options.namespace,
        limit: parseInt(options.limit, 10),
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      logger.error(`Search failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Display statistics about a knowledge base')
  .requiredOption('--name <kb>', 'Knowledge base name')
  .option('--namespace <prefix>', 'Filter stats to namespace')
  .option('--format <fmt>', 'Output format (table|json)', 'table')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (options: {
    name: string;
    namespace?: string;
    format: string;
    dataDir: string;
  }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, options.name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${options.name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const stats = await getStats(kb, { namespace: options.namespace });

      if (options.format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(formatStatsTable(stats));
      }
    } catch (err) {
      logger.error(`Stats failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('deps')
  .description('Trace dependencies for a symbol')
  .argument('<symbol>', 'Symbol name to trace')
  .requiredOption('--name <kb>', 'Knowledge base name')
  .option('--direction <dir>', 'Direction: in, out, or both', 'both')
  .option('--depth <n>', 'Transitive dependency depth', '1')
  .option('--format <fmt>', 'Output format (json|tree)', 'json')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (symbol: string, options: {
    name: string;
    direction: string;
    depth: string;
    format: string;
    dataDir: string;
  }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, options.name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${options.name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const deps = await getDependencies(kb, symbol, {
        direction: options.direction as DependencyDirection,
        depth: parseInt(options.depth, 10),
      });

      if (!deps) {
        console.error(`Symbol "${symbol}" not found`);
        process.exit(1);
      }

      if (options.format === 'tree') {
        console.log(formatDepsTree(deps));
      } else {
        console.log(JSON.stringify(deps, null, 2));
      }
    } catch (err) {
      logger.error(`Deps failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('find')
  .description('Find symbols matching specific criteria')
  .requiredOption('--name <kb>', 'Knowledge base name')
  .option('--kind <type>', 'Symbol kind filter (class|interface|struct|enum)')
  .option('--base <class>', 'Filter by base class/interface')
  .option('--namespace <prefix>', 'Namespace prefix filter')
  .option('--has-attribute <attr>', 'Has specific attribute')
  .option('--has-member <name>', 'Has member with name')
  .option('--is-unity-message', 'Member is a Unity message')
  .option('--limit <n>', 'Maximum results', '50')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (options: {
    name: string;
    kind?: string;
    base?: string;
    namespace?: string;
    hasAttribute?: string;
    hasMember?: string;
    isUnityMessage?: boolean;
    limit: string;
    dataDir: string;
  }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, options.name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${options.name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const result = await find(kb, {
        kind: options.kind as SearchableKind | undefined,
        base: options.base,
        namespace: options.namespace,
        hasAttribute: options.hasAttribute,
        hasMember: options.hasMember,
        isUnityMessage: options.isUnityMessage,
        limit: parseInt(options.limit, 10),
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      logger.error(`Find failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export symbol data in various formats')
  .requiredOption('--name <kb>', 'Knowledge base name')
  .option('--namespace <prefix>', 'Export specific namespace')
  .option('--file <path>', 'Export specific file')
  .option('--format <fmt>', 'Output format (json|md)', 'json')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (options: {
    name: string;
    namespace?: string;
    file?: string;
    format: string;
    dataDir: string;
  }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, options.name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${options.name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const symbols = await exportSymbols(kb, {
        namespace: options.namespace,
        file: options.file,
      });

      if (options.format === 'md') {
        console.log(formatMarkdown(symbols));
      } else {
        console.log(JSON.stringify(symbols, null, 2));
      }
    } catch (err) {
      logger.error(`Export failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('context')
  .description('Generate curated context for an AI agent based on a task')
  .argument('<task>', 'Task description')
  .requiredOption('--name <kb>', 'Knowledge base name')
  .option('--max-files <n>', 'Maximum files to include', '10')
  .option('--include-deps', 'Include dependency information')
  .option('--format <fmt>', 'Output format (md|json)', 'md')
  .option('--data-dir <dir>', 'Directory where knowledge bases are stored', 'data')
  .action(async (task: string, options: {
    name: string;
    maxFiles: string;
    includeDeps?: boolean;
    format: string;
    dataDir: string;
  }) => {
    try {
      const dataDir = resolve(options.dataDir);
      const kb = new KnowledgeBase(dataDir, options.name);

      if (!(await kb.exists())) {
        console.error(`Knowledge base "${options.name}" not found in ${dataDir}`);
        process.exit(1);
      }

      const context = await generateContext(kb, task, {
        maxFiles: parseInt(options.maxFiles, 10),
        includeDeps: options.includeDeps,
      });

      if (options.format === 'json') {
        console.log(JSON.stringify(context, null, 2));
      } else {
        console.log(formatContextMarkdown(context));
      }
    } catch (err) {
      logger.error(`Context generation failed: ${err}`);
      process.exit(1);
    }
  });

program.parse();
