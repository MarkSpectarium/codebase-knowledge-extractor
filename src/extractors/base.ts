import type { FileSymbols } from '../knowledge-base/schema.js';
import type { ScannedFile } from '../indexer/file-scanner.js';

export interface Extractor {
  name: string;
  supportedExtensions: string[];
  extract(files: ScannedFile[], rootPath: string): Promise<FileSymbols[]>;
}

export interface ExtractorProgress {
  current: number;
  total: number;
  file: string;
}

export type ProgressCallback = (progress: ExtractorProgress) => void;
