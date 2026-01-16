import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { StatsResult } from './types.js';

export interface StatsOptions {
  namespace?: string;
}

export async function getStats(
  kb: KnowledgeBase,
  options: StatsOptions = {}
): Promise<StatsResult> {
  const { namespace } = options;
  const meta = await kb.readMeta();
  const allFileSymbols = await kb.getAllFileSymbols();

  const namespaceCounts = new Map<string, number>();
  let totalSymbols = 0;
  let totalFiles = 0;

  for (const fileSymbols of allFileSymbols) {
    let fileMatches = false;

    for (const symbol of fileSymbols.symbols) {
      const ns = symbol.namespace || '(global)';

      if (namespace && !ns.startsWith(namespace)) {
        continue;
      }

      fileMatches = true;
      totalSymbols++;
      namespaceCounts.set(ns, (namespaceCounts.get(ns) || 0) + 1);
    }

    if (fileMatches || !namespace) {
      totalFiles++;
    }
  }

  const topNamespaces = Array.from(namespaceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ns, count]) => ({ namespace: ns, count }));

  return {
    name: meta?.name || 'unknown',
    files: namespace ? totalFiles : (meta?.fileCount || totalFiles),
    symbols: namespace ? totalSymbols : (meta?.symbolCount || totalSymbols),
    namespaces: namespaceCounts.size,
    topNamespaces,
  };
}

export function formatStatsTable(stats: StatsResult): string {
  const lines: string[] = [];

  lines.push(`Knowledge Base: ${stats.name}`);
  lines.push('─'.repeat(25));
  lines.push(`Files:        ${stats.files.toLocaleString()}`);
  lines.push(`Symbols:      ${stats.symbols.toLocaleString()}`);
  lines.push(`Namespaces:   ${stats.namespaces.toLocaleString()}`);
  lines.push('');
  lines.push('Top Namespaces by Symbol Count:');

  for (const ns of stats.topNamespaces) {
    const padding = ' '.repeat(Math.max(0, 25 - ns.namespace.length));
    lines.push(`  ${ns.namespace}${padding}${ns.count.toLocaleString()}`);
  }

  return lines.join('\n');
}
