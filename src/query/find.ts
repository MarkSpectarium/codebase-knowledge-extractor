import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { FindResult, FindMatch, FindCriteria, SearchableKind } from './types.js';

export interface FindOptions {
  kind?: SearchableKind;
  base?: string;
  namespace?: string;
  hasAttribute?: string;
  hasMember?: string;
  isUnityMessage?: boolean;
  limit?: number;
}

export async function find(
  kb: KnowledgeBase,
  options: FindOptions = {}
): Promise<FindResult> {
  const { kind, base, namespace, hasAttribute, hasMember, isUnityMessage, limit = 50 } = options;
  const allFileSymbols = await kb.getAllFileSymbols();
  const matches: FindMatch[] = [];

  const symbolKinds: SearchableKind[] = ['class', 'interface', 'struct', 'enum'];

  for (const fileSymbols of allFileSymbols) {
    for (const symbol of fileSymbols.symbols) {
      if (kind && symbolKinds.includes(kind) && symbol.kind !== kind) {
        continue;
      }

      if (namespace && !symbol.namespace?.startsWith(namespace)) {
        continue;
      }

      if (base && !symbol.bases?.some((b) => b.includes(base))) {
        continue;
      }

      if (hasAttribute && !symbol.attributes.some((a) => a.includes(hasAttribute))) {
        continue;
      }

      if (hasMember) {
        const memberNameLower = hasMember.toLowerCase();
        const hasMemberMatch = symbol.members?.some((m) => {
          const nameMatch = m.name.toLowerCase().includes(memberNameLower);
          if (isUnityMessage !== undefined) {
            return nameMatch && m.isUnityMessage === isUnityMessage;
          }
          return nameMatch;
        });
        if (!hasMemberMatch) continue;
      } else if (isUnityMessage !== undefined) {
        const hasUnityMessage = symbol.members?.some((m) => m.isUnityMessage === isUnityMessage);
        if (!hasUnityMessage) continue;
      }

      matches.push({
        symbol: symbol.name,
        namespace: symbol.namespace,
        file: fileSymbols.relativePath,
        line: symbol.line,
        bases: symbol.bases,
        memberCount: symbol.members?.length || 0,
      });
    }
  }

  const limited = matches.slice(0, limit);

  const criteria: FindCriteria = {};
  if (kind) criteria.kind = kind;
  if (base) criteria.base = base;
  if (namespace) criteria.namespace = namespace;
  if (hasAttribute) criteria.hasAttribute = hasAttribute;
  if (hasMember) criteria.hasMember = hasMember;
  if (isUnityMessage !== undefined) criteria.isUnityMessage = isUnityMessage;

  return {
    criteria,
    results: limited,
    total: matches.length,
  };
}
