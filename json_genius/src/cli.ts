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

const program = new Command();

program
  .name('json-genius')
  .description('Large JSON intelligence for AI agents')
  .version('0.1.0');

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
      const filePath = resolve(file);

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        console.error(`Error: ${filePath} is not a file`);
        process.exit(1);
      }

      const fileSizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);
      logger.debug(`Processing ${filePath} (${fileSizeMB} MB)`);

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

program.parse();
