import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scanDirectory, type ScannedFile } from './file-scanner.js';
import { createCSharpExtractor } from '../extractors/csharp/index.js';
import {
  KnowledgeBase,
  type FileManifest,
  type FileSymbols,
  type NamespaceSymbols,
} from '../knowledge-base/index.js';
import { logger } from '../utils/logger.js';

export interface IndexOptions {
  projectName: string;
  dataDir?: string;
  excludePatterns?: string[];
}

export interface IndexResult {
  projectName: string;
  fileCount: number;
  symbolCount: number;
  outputPath: string;
}

export async function indexProject(
  projectPath: string,
  options: IndexOptions
): Promise<IndexResult> {
  const rootPath = resolve(projectPath);
  const dataDir = options.dataDir ?? resolve(process.cwd(), 'data');

  logger.info(`Indexing project: ${rootPath}`);
  logger.info(`Project name: ${options.projectName}`);

  const kb = new KnowledgeBase(dataDir, options.projectName);
  await kb.initialize();

  const files = await scanDirectory(rootPath, {
    extensions: ['.cs'],
    respectGitignore: true,
    excludePatterns: options.excludePatterns,
  });

  if (files.length === 0) {
    logger.warn('No C# files found in project');
    await writeMeta(kb, rootPath, options.projectName, 0, 0);
    return {
      projectName: options.projectName,
      fileCount: 0,
      symbolCount: 0,
      outputPath: kb.getProjectPath(),
    };
  }

  logger.info(`Found ${files.length} C# files`);

  const extractor = createCSharpExtractor();
  const fileSymbols = await extractor.extract(files, rootPath);

  const manifest = await buildManifest(files, fileSymbols, rootPath);
  await kb.writeFileManifest(manifest);

  let totalSymbols = 0;
  const namespaceMap = new Map<string, NamespaceSymbols>();

  for (const fs of fileSymbols) {
    await kb.writeFileSymbols(fs);
    totalSymbols += fs.symbols.length;

    for (const symbol of fs.symbols) {
      const ns = symbol.namespace ?? '_global';
      if (!namespaceMap.has(ns)) {
        namespaceMap.set(ns, {
          namespace: ns,
          files: [],
          symbols: [],
        });
      }

      const nsSymbols = namespaceMap.get(ns)!;
      if (!nsSymbols.files.includes(fs.relativePath)) {
        nsSymbols.files.push(fs.relativePath);
      }
      nsSymbols.symbols.push({
        name: symbol.name,
        kind: symbol.kind,
        file: fs.relativePath,
        line: symbol.line,
      });
    }
  }

  for (const nsSymbols of namespaceMap.values()) {
    await kb.writeNamespaceSymbols(nsSymbols);
  }

  await writeMeta(kb, rootPath, options.projectName, files.length, totalSymbols);

  logger.info(`Indexing complete: ${files.length} files, ${totalSymbols} symbols`);

  return {
    projectName: options.projectName,
    fileCount: files.length,
    symbolCount: totalSymbols,
    outputPath: kb.getProjectPath(),
  };
}

async function buildManifest(
  files: ScannedFile[],
  fileSymbols: FileSymbols[],
  _rootPath: string
): Promise<FileManifest> {
  const symbolCountMap = new Map<string, number>();
  for (const fs of fileSymbols) {
    symbolCountMap.set(fs.relativePath, fs.symbols.length);
  }

  const entries = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file.path, 'utf-8');
      const hash = KnowledgeBase.computeFileHash(content);

      return {
        path: file.path.replace(/\\/g, '/'),
        relativePath: file.relativePath,
        size: file.size,
        lastModified: file.lastModified.toISOString(),
        hash,
        symbolCount: symbolCountMap.get(file.relativePath) ?? 0,
      };
    })
  );

  return { files: entries };
}

async function writeMeta(
  kb: KnowledgeBase,
  rootPath: string,
  projectName: string,
  fileCount: number,
  symbolCount: number
): Promise<void> {
  await kb.writeMeta({
    name: projectName,
    rootPath,
    indexedAt: new Date().toISOString(),
    fileCount,
    symbolCount,
  });
}

export { KnowledgeBase };
