import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import type {
  ProjectMeta,
  FileManifest,
  FileManifestEntry,
  FileSymbols,
  NamespaceSymbols,
} from './schema.js';

export class KnowledgeBase {
  private basePath: string;
  private projectPath: string;

  constructor(dataDir: string, projectName: string) {
    this.basePath = dataDir;
    this.projectPath = join(dataDir, projectName);
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.projectPath, 'symbols', 'by-file'), { recursive: true });
    await mkdir(join(this.projectPath, 'symbols', 'by-namespace'), { recursive: true });
    logger.debug(`Initialized KB directory: ${this.projectPath}`);
  }

  async writeMeta(meta: ProjectMeta): Promise<void> {
    const metaPath = join(this.projectPath, 'meta.json');
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    logger.debug(`Wrote project metadata`);
  }

  async writeFileManifest(manifest: FileManifest): Promise<void> {
    const manifestPath = join(this.projectPath, 'files.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    logger.debug(`Wrote file manifest with ${manifest.files.length} files`);
  }

  async writeFileSymbols(fileSymbols: FileSymbols): Promise<void> {
    const safeFileName = this.pathToFileName(fileSymbols.relativePath);
    const filePath = join(this.projectPath, 'symbols', 'by-file', `${safeFileName}.json`);
    await writeFile(filePath, JSON.stringify(fileSymbols, null, 2));
  }

  async writeNamespaceSymbols(namespaceSymbols: NamespaceSymbols): Promise<void> {
    const safeFileName = this.namespaceToFileName(namespaceSymbols.namespace);
    const filePath = join(this.projectPath, 'symbols', 'by-namespace', `${safeFileName}.json`);
    await writeFile(filePath, JSON.stringify(namespaceSymbols, null, 2));
  }

  async readMeta(): Promise<ProjectMeta | null> {
    try {
      const metaPath = join(this.projectPath, 'meta.json');
      const content = await readFile(metaPath, 'utf-8');
      return JSON.parse(content) as ProjectMeta;
    } catch {
      return null;
    }
  }

  async readFileManifest(): Promise<FileManifest | null> {
    try {
      const manifestPath = join(this.projectPath, 'files.json');
      const content = await readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as FileManifest;
    } catch {
      return null;
    }
  }

  async listIndexedFiles(): Promise<FileManifestEntry[]> {
    const manifest = await this.readFileManifest();
    return manifest?.files ?? [];
  }

  async exists(): Promise<boolean> {
    const meta = await this.readMeta();
    return meta !== null;
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  async readFileSymbols(relativePath: string): Promise<FileSymbols | null> {
    const safeFileName = this.pathToFileName(relativePath);
    const filePath = join(this.projectPath, 'symbols', 'by-file', `${safeFileName}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as FileSymbols;
    } catch {
      return null;
    }
  }

  async readNamespaceSymbols(namespace: string): Promise<NamespaceSymbols | null> {
    const safeFileName = this.namespaceToFileName(namespace);
    const filePath = join(this.projectPath, 'symbols', 'by-namespace', `${safeFileName}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as NamespaceSymbols;
    } catch {
      return null;
    }
  }

  async listNamespaces(): Promise<string[]> {
    try {
      const nsDir = join(this.projectPath, 'symbols', 'by-namespace');
      const files = await readdir(nsDir);
      return files.map(f => f.replace('.json', '').replace(/_/g, '.'));
    } catch {
      return [];
    }
  }

  async getAllFileSymbols(): Promise<FileSymbols[]> {
    const manifest = await this.readFileManifest();
    if (!manifest) return [];

    const results: FileSymbols[] = [];
    for (const file of manifest.files) {
      const symbols = await this.readFileSymbols(file.relativePath);
      if (symbols) results.push(symbols);
    }
    return results;
  }

  static async listProjects(dataDir: string): Promise<string[]> {
    try {
      const entries = await readdir(dataDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  static computeFileHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private pathToFileName(relativePath: string): string {
    return relativePath
      .replace(/\\/g, '/')
      .replace(/\//g, '__')
      .replace(/\.cs$/, '');
  }

  private namespaceToFileName(namespace: string): string {
    return namespace.replace(/\./g, '_') || '_global';
  }
}

export type { ProjectMeta, FileManifest, FileManifestEntry, FileSymbols, NamespaceSymbols };
