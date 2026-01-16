import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { SearchResult, SearchMatch, SearchableKind } from './types.js';

export interface SearchOptions {
  kind?: SearchableKind;
  namespace?: string;
  pathFilter?: string;
  limit?: number;
}

export async function search(
  kb: KnowledgeBase,
  term: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const { kind, namespace, pathFilter, limit = 50 } = options;
  const termLower = term.toLowerCase();
  const matches: SearchMatch[] = [];

  const allFileSymbols = await kb.getAllFileSymbols();

  for (const fileSymbols of allFileSymbols) {
    if (pathFilter && !fileSymbols.relativePath.startsWith(pathFilter)) {
      continue;
    }

    for (const symbol of fileSymbols.symbols) {
      if (namespace && !symbol.namespace?.startsWith(namespace)) {
        continue;
      }

      const symbolKinds: SearchableKind[] = ['class', 'interface', 'struct', 'enum'];
      const memberKinds: SearchableKind[] = ['method', 'property', 'field', 'enumMember'];

      if (kind && symbolKinds.includes(kind as SearchableKind)) {
        if (symbol.kind !== kind) continue;
      }

      if (symbol.name.toLowerCase().includes(termLower)) {
        if (!kind || symbolKinds.includes(kind as SearchableKind)) {
          matches.push({
            symbol: symbol.name,
            kind: symbol.kind,
            namespace: symbol.namespace,
            file: fileSymbols.relativePath,
            line: symbol.line,
            match: 'name',
          });
        }
      }

      if (symbol.members) {
        for (const member of symbol.members) {
          if (kind && memberKinds.includes(kind as SearchableKind) && member.kind !== kind) {
            continue;
          }

          if (member.name.toLowerCase().includes(termLower)) {
            matches.push({
              symbol: `${symbol.name}.${member.name}`,
              kind: member.kind,
              namespace: symbol.namespace,
              file: fileSymbols.relativePath,
              line: member.line,
              match: 'member',
            });
          } else if (member.signature?.toLowerCase().includes(termLower)) {
            matches.push({
              symbol: `${symbol.name}.${member.name}`,
              kind: member.kind,
              namespace: symbol.namespace,
              file: fileSymbols.relativePath,
              line: member.line,
              match: 'signature',
            });
          }
        }
      }
    }
  }

  const limited = matches.slice(0, limit);

  return {
    query: term,
    results: limited,
    total: matches.length,
  };
}
