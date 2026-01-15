import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { Extractor, ProgressCallback } from '../base.js';
import type { FileSymbols, RoslynOutput } from '../../knowledge-base/schema.js';
import type { ScannedFile } from '../../indexer/file-scanner.js';
import { extractWithRoslyn } from './roslyn-bridge.js';
import { KnowledgeBase } from '../../knowledge-base/index.js';
import { logger } from '../../utils/logger.js';

export class CSharpExtractor implements Extractor {
  name = 'csharp';
  supportedExtensions = ['.cs'];

  private progressCallback?: ProgressCallback;

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  async extract(files: ScannedFile[], rootPath: string): Promise<FileSymbols[]> {
    const results: FileSymbols[] = [];
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const current = i + 1;

      if (this.progressCallback) {
        this.progressCallback({
          current,
          total,
          file: file.relativePath,
        });
      } else {
        logger.progress(current, total, file.relativePath);
      }

      try {
        const content = await readFile(file.path, 'utf-8');
        const hash = KnowledgeBase.computeFileHash(content);

        const roslynResults = await extractWithRoslyn([file.path]);
        const roslynOutput = roslynResults[0];

        if (roslynOutput) {
          const fileSymbols = this.transformOutput(roslynOutput, file, rootPath, hash);
          results.push(fileSymbols);
        } else {
          results.push(this.createEmptyResult(file, rootPath));
        }
      } catch (err) {
        logger.warn(`Failed to process ${file.relativePath}: ${err}`);
        results.push(this.createEmptyResult(file, rootPath));
      }
    }

    return results;
  }

  private transformOutput(
    output: RoslynOutput,
    file: ScannedFile,
    rootPath: string,
    _hash: string
  ): FileSymbols {
    return {
      file: file.path.replace(/\\/g, '/'),
      relativePath: relative(rootPath, file.path).replace(/\\/g, '/'),
      symbols: output.symbols,
      usings: output.usings,
      dependencies: output.dependencies,
    };
  }

  private createEmptyResult(file: ScannedFile, rootPath: string): FileSymbols {
    return {
      file: file.path.replace(/\\/g, '/'),
      relativePath: relative(rootPath, file.path).replace(/\\/g, '/'),
      symbols: [],
      usings: [],
      dependencies: { types: [], calls: [] },
    };
  }
}

export function createCSharpExtractor(): CSharpExtractor {
  return new CSharpExtractor();
}
