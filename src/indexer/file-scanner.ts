import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const ignore = require('ignore') as () => {
  add(patterns: string | readonly string[]): void;
  ignores(pathname: string): boolean;
};

type Ignore = ReturnType<typeof ignore>;

export interface ScannedFile {
  path: string;
  relativePath: string;
  size: number;
  lastModified: Date;
}

export interface ScanOptions {
  extensions?: string[];
  respectGitignore?: boolean;
}

const DEFAULT_OPTIONS: Required<ScanOptions> = {
  extensions: ['.cs'],
  respectGitignore: true,
};

export async function scanDirectory(
  rootPath: string,
  options: ScanOptions = {}
): Promise<ScannedFile[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const files: ScannedFile[] = [];

  let ig: Ignore | null = null;
  if (opts.respectGitignore) {
    ig = await loadGitignore(rootPath);
  }

  await scanRecursive(rootPath, rootPath, files, opts.extensions, ig);

  logger.info(`Scanned ${files.length} files in ${rootPath}`);
  return files;
}

async function scanRecursive(
  currentPath: string,
  rootPath: string,
  files: ScannedFile[],
  extensions: string[],
  ig: Ignore | null
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    logger.warn(`Cannot read directory: ${currentPath}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name);
    const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');

    if (entry.name.startsWith('.')) {
      continue;
    }

    if (ig && ig.ignores(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') {
        continue;
      }
      await scanRecursive(fullPath, rootPath, files, extensions, ig);
    } else if (entry.isFile()) {
      const hasValidExtension = extensions.some((ext) => entry.name.endsWith(ext));
      if (hasValidExtension) {
        try {
          const stats = await stat(fullPath);
          files.push({
            path: fullPath,
            relativePath,
            size: stats.size,
            lastModified: stats.mtime,
          });
        } catch {
          logger.warn(`Cannot stat file: ${fullPath}`);
        }
      }
    }
  }
}

async function loadGitignore(rootPath: string): Promise<Ignore> {
  const ig = ignore();

  ig.add(['node_modules', '.git', 'bin', 'obj', 'Library', 'Temp', 'Logs', 'Build']);

  try {
    const gitignorePath = join(rootPath, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore file, use defaults only
  }

  return ig;
}
