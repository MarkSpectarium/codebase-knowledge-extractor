import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import type { RoslynOutput, RoslynResult } from '../../knowledge-base/schema.js';
import { isRoslynError } from '../../knowledge-base/schema.js';

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

const TIMEOUT_PER_FILE_MS = 2000;
const TIMEOUT_OVERHEAD_MS = 30000;

export async function extractWithRoslyn(
  filePaths: string[],
  options: RoslynBridgeOptions = {}
): Promise<(RoslynOutput | null)[]> {
  if (filePaths.length === 0) {
    return [];
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dynamicTimeout = opts.timeout || (filePaths.length * TIMEOUT_PER_FILE_MS + TIMEOUT_OVERHEAD_MS);

  return runBatchExtractor(filePaths, dynamicTimeout);
}

export async function extractSingleFile(filePath: string): Promise<RoslynOutput | null> {
  const results = await extractWithRoslyn([filePath]);
  return results[0] ?? null;
}

function runBatchExtractor(filePaths: string[], timeout: number): Promise<(RoslynOutput | null)[]> {
  return new Promise((resolve, reject) => {
    const dllPath = join(
      ROSLYN_TOOL_PATH,
      'bin',
      'Release',
      'net9.0',
      'RoslynExtractor.dll'
    );

    const proc = spawn('dotnet', [dllPath, '--stdin'], {
      cwd: ROSLYN_TOOL_PATH,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results: (RoslynOutput | null)[] = [];
    const resultMap = new Map<string, RoslynOutput | null>();
    let buffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();

      // Process complete lines (NDJSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as RoslynResult;

          if (isRoslynError(parsed)) {
            logger.warn(`Roslyn extraction failed for ${parsed.file}: ${parsed.error}`);
            resultMap.set(parsed.file, null);
          } else {
            resultMap.set(parsed.file, parsed);
          }
        } catch (err) {
          logger.debug(`Failed to parse Roslyn output line: ${err}`);
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const stderr = data.toString();
      if (stderr.trim()) {
        logger.debug(`Roslyn stderr: ${stderr}`);
      }
    });

    proc.on('close', (code) => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer) as RoslynResult;

          if (isRoslynError(parsed)) {
            logger.warn(`Roslyn extraction failed for ${parsed.file}: ${parsed.error}`);
            resultMap.set(parsed.file, null);
          } else {
            resultMap.set(parsed.file, parsed);
          }
        } catch (err) {
          logger.debug(`Failed to parse final Roslyn output: ${err}`);
        }
      }

      // Build results array in the same order as input
      for (const filePath of filePaths) {
        const result = resultMap.get(filePath);
        results.push(result ?? null);
      }

      if (code !== 0 && results.every(r => r === null)) {
        logger.warn(`Roslyn extractor exited with code ${code}`);
      }

      resolve(results);
    });

    proc.on('error', (err) => {
      reject(err);
    });

    // Write all file paths to stdin
    for (const filePath of filePaths) {
      proc.stdin.write(filePath + '\n');
    }
    proc.stdin.end();
  });
}

export function getRoslynToolPath(): string {
  return ROSLYN_TOOL_PATH;
}
