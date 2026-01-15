export interface ProjectMeta {
  name: string;
  rootPath: string;
  indexedAt: string;
  fileCount: number;
  symbolCount: number;
}

export interface FileManifestEntry {
  path: string;
  relativePath: string;
  size: number;
  lastModified: string;
  hash: string;
  symbolCount: number;
}

export interface FileManifest {
  files: FileManifestEntry[];
}

export interface MemberInfo {
  name: string;
  kind: 'method' | 'property' | 'field' | 'enumMember';
  line: number;
  signature?: string;
  modifiers: string[];
  attributes: string[];
  isUnityMessage?: boolean;
}

export interface SymbolInfo {
  name: string;
  kind: 'class' | 'interface' | 'struct' | 'enum';
  namespace?: string;
  line: number;
  endLine: number;
  modifiers: string[];
  bases?: string[];
  attributes: string[];
  members?: MemberInfo[];
}

export interface DependencyInfo {
  types: string[];
  calls: string[];
}

export interface FileSymbols {
  file: string;
  relativePath: string;
  symbols: SymbolInfo[];
  usings: string[];
  dependencies: DependencyInfo;
}

export interface NamespaceSymbols {
  namespace: string;
  files: string[];
  symbols: Array<{
    name: string;
    kind: string;
    file: string;
    line: number;
  }>;
}

export interface RoslynOutput {
  file: string;
  symbols: SymbolInfo[];
  usings: string[];
  dependencies: DependencyInfo;
}

export interface RoslynError {
  file: string;
  error: string;
}

export type RoslynResult = RoslynOutput | RoslynError;

export function isRoslynError(result: RoslynResult): result is RoslynError {
  return 'error' in result;
}
