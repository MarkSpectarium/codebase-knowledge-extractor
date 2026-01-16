import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { FileSymbols } from '../knowledge-base/schema.js';
import type { ExportSymbol } from './types.js';

export interface ExportOptions {
  namespace?: string;
  file?: string;
}

export type ExportFormat = 'json' | 'md';

export async function exportSymbols(
  kb: KnowledgeBase,
  options: ExportOptions = {}
): Promise<ExportSymbol[]> {
  const { namespace, file } = options;
  const allFileSymbols = await kb.getAllFileSymbols();
  const symbols: ExportSymbol[] = [];

  for (const fileSymbols of allFileSymbols) {
    if (file && fileSymbols.relativePath !== file) {
      continue;
    }

    for (const symbol of fileSymbols.symbols) {
      if (namespace && !symbol.namespace?.startsWith(namespace)) {
        continue;
      }

      symbols.push({
        name: symbol.name,
        kind: symbol.kind,
        namespace: symbol.namespace,
        file: fileSymbols.relativePath,
        line: symbol.line,
        bases: symbol.bases,
        attributes: symbol.attributes,
        members: symbol.members?.map((m) => ({
          name: m.name,
          kind: m.kind,
          signature: m.signature,
          modifiers: m.modifiers,
          attributes: m.attributes,
          isUnityMessage: m.isUnityMessage,
        })),
        dependencies: fileSymbols.dependencies,
      });
    }
  }

  return symbols;
}

export function formatMarkdown(symbols: ExportSymbol[]): string {
  const lines: string[] = [];
  const byNamespace = new Map<string, ExportSymbol[]>();

  for (const symbol of symbols) {
    const ns = symbol.namespace || '(global)';
    if (!byNamespace.has(ns)) {
      byNamespace.set(ns, []);
    }
    byNamespace.get(ns)!.push(symbol);
  }

  const sortedNamespaces = Array.from(byNamespace.keys()).sort();

  for (const ns of sortedNamespaces) {
    lines.push(`# ${ns}`);
    lines.push('');

    const nsSymbols = byNamespace.get(ns)!;
    for (const symbol of nsSymbols) {
      lines.push(`## ${symbol.name}`);
      lines.push(`**Kind:** ${symbol.kind}`);
      lines.push(`**File:** ${symbol.file}:${symbol.line}`);
      if (symbol.namespace) {
        lines.push(`**Namespace:** ${symbol.namespace}`);
      }
      if (symbol.bases && symbol.bases.length > 0) {
        lines.push(`**Bases:** ${symbol.bases.join(', ')}`);
      }
      if (symbol.attributes.length > 0) {
        lines.push(`**Attributes:** ${symbol.attributes.join(', ')}`);
      }
      lines.push('');

      if (symbol.members && symbol.members.length > 0) {
        lines.push('### Members');
        for (const member of symbol.members) {
          const sig = member.signature ? `: ${member.signature}` : '';
          const unity = member.isUnityMessage ? ' (Unity)' : '';
          lines.push(`- \`${member.name}${sig}\` (${member.kind})${unity}`);
        }
        lines.push('');
      }

      if (symbol.dependencies) {
        const hasTypes = symbol.dependencies.types.length > 0;
        const hasCalls = symbol.dependencies.calls.length > 0;
        if (hasTypes || hasCalls) {
          lines.push('### Dependencies');
          if (hasTypes) {
            lines.push(`- Types: ${symbol.dependencies.types.join(', ')}`);
          }
          if (hasCalls) {
            lines.push(`- Calls: ${symbol.dependencies.calls.join(', ')}`);
          }
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}
