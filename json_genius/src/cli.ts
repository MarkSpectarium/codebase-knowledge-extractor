#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { logger } from './utils/logger.js';
import {
  extractSchema,
  formatSchemaYaml,
  formatSchemaJson,
} from './analyzer/schema-extractor.js';
import { sampleData, formatSamples } from './analyzer/sampler.js';
import { executeQuery, formatQueryResults } from './query/path-query.js';
import {
  count,
  groupBy,
  stats,
  distribution,
  formatGroupByResult,
  formatStatsResult,
  formatDistributionResult,
} from './query/aggregate.js';
import {
  findRelationships,
  formatRelationshipResult,
} from './analyzer/relationship-finder.js';
import {
  resolveType,
  formatTypeResult,
  closeClient,
} from './type-resolver/mcp-bridge.js';
import {
  executeJoin,
  formatJoinResults,
} from './query/join.js';
import {
  runReport,
  formatReportResult,
  AVAILABLE_REPORTS,
  type ReportName,
} from './analytics/reports.js';
import { startMcpServer } from './mcp/server.js';

const program = new Command();

program
  .name('json-genius')
  .description('Large JSON intelligence for AI agents')
  .version('0.1.0');

async function validateFile(file: string): Promise<{ path: string; sizeMB: string }> {
  const filePath = resolve(file);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`${filePath} is not a file`);
  }
  const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);
  return { path: filePath, sizeMB };
}

program
  .command('schema')
  .description('Extract a compact schema from a large JSON file')
  .argument('<file>', 'Path to the JSON file')
  .option('--depth <n>', 'Maximum depth to extract', '10')
  .option('--samples <n>', 'Maximum samples per path for merging', '5')
  .option('--no-patterns', 'Disable pattern detection')
  .option('--format <fmt>', 'Output format (yaml|json)', 'yaml')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    depth: string;
    samples: string;
    patterns: boolean;
    format: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Processing ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const schema = await extractSchema(filePath, {
        maxDepth: parseInt(options.depth, 10),
        maxSamples: parseInt(options.samples, 10),
        detectPatterns: options.patterns,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Schema extraction completed in ${elapsed}s`);

      if (options.format === 'json') {
        console.log(formatSchemaJson(schema));
      } else {
        console.log(formatSchemaYaml(schema));
      }
    } catch (err) {
      logger.error(`Schema extraction failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('sample')
  .description('Extract representative data samples from a JSON file')
  .argument('<file>', 'Path to the JSON file')
  .option('--count <n>', 'Number of samples to extract', '3')
  .option('--path <path>', 'JSONPath-like path to sample from')
  .option('--entity-type <type>', 'Filter by entity type (e.g., "Player", "PlayerCharacter")')
  .option('--seed <n>', 'Random seed for reproducible sampling')
  .option('--truncate <n>', 'Maximum string length before truncation', '200')
  .option('--depth <n>', 'Maximum depth for nested objects', '10')
  .option('--format <fmt>', 'Output format (pretty|json)', 'pretty')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    count: string;
    path?: string;
    entityType?: string;
    seed?: string;
    truncate: string;
    depth: string;
    format: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Sampling from ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const result = await sampleData(filePath, {
        count: parseInt(options.count, 10),
        path: options.path,
        entityType: options.entityType,
        seed: options.seed ? parseInt(options.seed, 10) : undefined,
        truncateStrings: parseInt(options.truncate, 10),
        maxDepth: parseInt(options.depth, 10),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Sampling completed in ${elapsed}s`);

      console.log(formatSamples(result, options.format as 'json' | 'pretty'));
    } catch (err) {
      logger.error(`Sampling failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('query')
  .description('Execute a path-based query on a JSON file')
  .argument('<file>', 'Path to the JSON file')
  .option('--select <fields>', 'Comma-separated fields to select (e.g., "entityId,payload.name")')
  .option('--filter <expr>', 'Filter expression (e.g., "payload.level > 10")')
  .option('--limit <n>', 'Maximum number of results', '100')
  .option('--offset <n>', 'Skip first N results', '0')
  .option('--format <fmt>', 'Output format (json|table|lines)', 'json')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    select?: string;
    filter?: string;
    limit: string;
    offset: string;
    format: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Querying ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const result = await executeQuery(filePath, {
        select: options.select?.split(',').map(s => s.trim()),
        filter: options.filter,
        limit: parseInt(options.limit, 10),
        offset: parseInt(options.offset, 10),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Query completed in ${elapsed}s`);

      console.log(formatQueryResults(result, options.format as 'json' | 'table' | 'lines'));
    } catch (err) {
      logger.error(`Query failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('count')
  .description('Count items in a JSON file, optionally with a filter')
  .argument('<file>', 'Path to the JSON file')
  .option('--filter <expr>', 'Filter expression (e.g., "payload.level > 10")')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    filter?: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Counting in ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const result = await count(filePath, { filter: options.filter });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Count completed in ${elapsed}s`);

      console.log(`Count: ${result.total} (scanned ${result.scanned})`);
    } catch (err) {
      logger.error(`Count failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('group')
  .description('Group items by a field value and count occurrences')
  .argument('<file>', 'Path to the JSON file')
  .requiredOption('--path <path>', 'Path to the field to group by')
  .option('--filter <expr>', 'Filter expression')
  .option('--sort <by>', 'Sort by "key" or "count"', 'count')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    path: string;
    filter?: string;
    sort: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Grouping in ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const result = await groupBy(filePath, {
        path: options.path,
        filter: options.filter,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Group completed in ${elapsed}s`);

      console.log(formatGroupByResult(result, options.sort as 'key' | 'count'));
    } catch (err) {
      logger.error(`Group failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Calculate statistics for a numeric field')
  .argument('<file>', 'Path to the JSON file')
  .requiredOption('--path <path>', 'Path to the numeric field')
  .option('--filter <expr>', 'Filter expression')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    path: string;
    filter?: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Calculating stats in ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const result = await stats(filePath, {
        path: options.path,
        filter: options.filter,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Stats completed in ${elapsed}s`);

      console.log(formatStatsResult(result));
    } catch (err) {
      logger.error(`Stats failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('distribution')
  .description('Show distribution of numeric values across buckets')
  .argument('<file>', 'Path to the JSON file')
  .requiredOption('--path <path>', 'Path to the numeric field')
  .option('--buckets <n>', 'Number of buckets', '10')
  .option('--filter <expr>', 'Filter expression')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options: {
    path: string;
    buckets: string;
    filter?: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: filePath, sizeMB } = await validateFile(file);
      logger.debug(`Calculating distribution in ${filePath} (${sizeMB} MB)`);

      const startTime = Date.now();

      const result = await distribution(filePath, {
        path: options.path,
        filter: options.filter,
        buckets: parseInt(options.buckets, 10),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Distribution completed in ${elapsed}s`);

      console.log(formatDistributionResult(result));
    } catch (err) {
      logger.error(`Distribution failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('relationships')
  .description('Detect relationships between two JSON files by analyzing ID patterns')
  .argument('<file1>', 'Path to the first JSON file')
  .argument('<file2>', 'Path to the second JSON file')
  .option('--min-coverage <n>', 'Minimum coverage % to report', '50')
  .option('-v, --verbose', 'Show all detected ID fields even if no matches found')
  .action(async (file1: string, file2: string, options: {
    minCoverage: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: leftPath } = await validateFile(file1);
      const { path: rightPath } = await validateFile(file2);

      const startTime = Date.now();

      const result = await findRelationships(leftPath, rightPath, {
        minCoverage: parseInt(options.minCoverage, 10),
        verbose: options.verbose,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Relationship detection completed in ${elapsed}s`);

      console.log(formatRelationshipResult(result, options.verbose));
    } catch (err) {
      logger.error(`Relationship detection failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('type')
  .description('Look up a $type annotation in the codebase knowledge base')
  .argument('<type>', 'The type name to look up (e.g., "Myths.SharedCode.PlayerModel")')
  .requiredOption('--project <name>', 'Knowledge base project name')
  .option('--show-deps', 'Also show type dependencies')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (typeName: string, options: {
    project: string;
    showDeps?: boolean;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const startTime = Date.now();

      const result = await resolveType(typeName, {
        project: options.project,
        showDeps: options.showDeps,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Type resolution completed in ${elapsed}s`);

      console.log(formatTypeResult(result));

      await closeClient();
    } catch (err) {
      logger.error(`Type resolution failed: ${err}`);
      await closeClient();
      process.exit(1);
    }
  });

program
  .command('join')
  .description('Query across two related JSON files using detected or specified relationships')
  .argument('<file1>', 'Path to the left JSON file')
  .argument('<file2>', 'Path to the right JSON file')
  .option('--left-key <path>', 'Path to join key in left file')
  .option('--right-key <path>', 'Path to join key in right file')
  .option('--select <fields>', 'Fields to select (prefix with a. or b.)')
  .option('--filter <expr>', 'Filter expression (prefix paths with a. or b.)')
  .option('--limit <n>', 'Maximum number of results', '100')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file1: string, file2: string, options: {
    leftKey?: string;
    rightKey?: string;
    select?: string;
    filter?: string;
    limit: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      const { path: leftPath } = await validateFile(file1);
      const { path: rightPath } = await validateFile(file2);

      const startTime = Date.now();

      const result = await executeJoin(leftPath, rightPath, {
        leftKey: options.leftKey,
        rightKey: options.rightKey,
        select: options.select?.split(',').map(s => s.trim()),
        filter: options.filter,
        limit: parseInt(options.limit, 10),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Join completed in ${elapsed}s`);

      console.log(formatJoinResults(result));
    } catch (err) {
      logger.error(`Join failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Run pre-built analytics reports on a directory of JSON files')
  .argument('<directory>', 'Directory containing JSON files')
  .requiredOption('--report <name>', `Report name (${AVAILABLE_REPORTS.join(', ')})`)
  .option('--format <fmt>', 'Output format (text|json)', 'text')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (directory: string, options: {
    report: string;
    format: string;
    verbose?: boolean;
  }) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    try {
      if (!AVAILABLE_REPORTS.includes(options.report as ReportName)) {
        logger.error(`Unknown report: ${options.report}. Available: ${AVAILABLE_REPORTS.join(', ')}`);
        process.exit(1);
      }

      const startTime = Date.now();

      const result = await runReport(directory, options.report as ReportName, {
        format: options.format as 'text' | 'json',
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.debug(`Report completed in ${elapsed}s`);

      console.log(formatReportResult(result, options.format as 'text' | 'json'));
    } catch (err) {
      logger.error(`Report failed: ${err}`);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the MCP server for AI agent tool access')
  .option('--data-dir <dir>', 'Working directory for file operations')
  .action(async (options: {
    dataDir?: string;
  }) => {
    try {
      await startMcpServer({
        dataDir: options.dataDir,
      });
    } catch (err) {
      logger.error(`MCP server failed: ${err}`);
      process.exit(1);
    }
  });

program.parse();
