#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { indexProject, KnowledgeBase } from './indexer/index.js';
import { logger } from './utils/logger.js';

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

program.parse();
