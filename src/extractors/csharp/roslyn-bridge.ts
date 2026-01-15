import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import type { RoslynOutput } from '../../knowledge-base/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROSLYN_TOOL_PATH = join(__dirname, '..', '..', '..', 'tools', 'roslyn-extractor');

export interface RoslynBridgeOptions {
  batchSize?: number;
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<RoslynBridgeOptions> = {
  batchSize: 50,
  timeout: 60000,
};

export async function extractWithRoslyn(
  filePaths: string[],
  options: RoslynBridgeOptions = {}
): Promise<RoslynOutput[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: RoslynOutput[] = [];

  for (let i = 0; i < filePaths.length; i += opts.batchSize) {
    const batch = filePaths.slice(i, i + opts.batchSize);
    const batchResults = await processBatch(batch, opts.timeout);
    results.push(...batchResults);
  }

  return results;
}

export async function extractSingleFile(filePath: string): Promise<RoslynOutput | null> {
  const results = await extractWithRoslyn([filePath]);
  return results[0] ?? null;
}

async function processBatch(filePaths: string[], timeout: number): Promise<RoslynOutput[]> {
  const results: RoslynOutput[] = [];

  for (const filePath of filePaths) {
    try {
      const result = await runRoslynExtractor(filePath, timeout);
      if (result) {
        results.push(result);
      }
    } catch (err) {
      logger.warn(`Failed to extract symbols from ${filePath}: ${err}`);
    }
  }

  return results;
}

function runRoslynExtractor(filePath: string, timeout: number): Promise<RoslynOutput | null> {
  return new Promise((resolve, reject) => {
    const dllPath = join(
      ROSLYN_TOOL_PATH,
      'bin',
      'Release',
      'net9.0',
      'RoslynExtractor.dll'
    );

    const proc = spawn('dotnet', [dllPath, filePath], {
      cwd: ROSLYN_TOOL_PATH,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        if (stderr) {
          logger.debug(`Roslyn stderr: ${stderr}`);
        }
        resolve(null);
        return;
      }

      try {
        const lines = stdout.trim().split('\n');
        if (lines.length > 0 && lines[0]) {
          const result = JSON.parse(lines[0]) as RoslynOutput;
          resolve(result);
        } else {
          resolve(null);
        }
      } catch (err) {
        logger.debug(`Failed to parse Roslyn output: ${err}`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export function getRoslynToolPath(): string {
  return ROSLYN_TOOL_PATH;
}
