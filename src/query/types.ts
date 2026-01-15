export type SymbolKind = 'class' | 'interface' | 'struct' | 'enum';
export type MemberKind = 'method' | 'property' | 'field' | 'enumMember';
export type SearchableKind = SymbolKind | MemberKind;

export interface SearchMatch {
  symbol: string;
  kind: SearchableKind;
  namespace?: string;
  file: string;
  line: number;
  match: 'name' | 'member' | 'signature';
}

export interface SearchResult {
  query: string;
  results: SearchMatch[];
  total: number;
}

export interface StatsResult {
  name: string;
  files: number;
  symbols: number;
  namespaces: number;
  topNamespaces: Array<{ namespace: string; count: number }>;
}

export interface DependencyRef {
  symbol: string;
  file: string;
  namespace?: string;
}

export interface DepsResult {
  symbol: string;
  namespace?: string;
  file: string;
  incoming: DependencyRef[];
  outgoing: DependencyRef[];
  incomingCount: number;
  outgoingCount: number;
}

export interface FindMatch {
  symbol: string;
  namespace?: string;
  file: string;
  line: number;
  bases?: string[];
  memberCount: number;
}

export interface FindCriteria {
  kind?: SearchableKind;
  base?: string;
  namespace?: string;
  hasAttribute?: string;
  hasMember?: string;
  isUnityMessage?: boolean;
}

export interface FindResult {
  criteria: FindCriteria;
  results: FindMatch[];
  total: number;
}

export interface ExportSymbol {
  name: string;
  kind: string;
  namespace?: string;
  file: string;
  line: number;
  bases?: string[];
  attributes: string[];
  members?: Array<{
    name: string;
    kind: string;
    signature?: string;
    modifiers: string[];
    attributes: string[];
    isUnityMessage?: boolean;
  }>;
  dependencies?: {
    types: string[];
    calls: string[];
  };
}

export interface ContextFile {
  file: string;
  symbols: string[];
  relevance: string;
  score: number;
}

export interface InterfaceMapping {
  interface: string;
  implementations: string[];
}

export interface DependencyWarning {
  symbol: string;
  dependentCount: number;
  message: string;
}

export interface ContextResult {
  task: string;
  files: ContextFile[];
  interfaceMap: InterfaceMapping[];
  warnings: DependencyWarning[];
  startingPoints: string[];
}
