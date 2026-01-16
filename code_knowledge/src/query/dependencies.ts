import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { FileSymbols, SymbolInfo } from '../knowledge-base/schema.js';
import type { DepsResult, DependencyRef } from './types.js';

export type DependencyDirection = 'in' | 'out' | 'both';

export interface DepsOptions {
  direction?: DependencyDirection;
  depth?: number;
}

interface SymbolLocation {
  symbol: SymbolInfo;
  file: FileSymbols;
}

export async function getDependencies(
  kb: KnowledgeBase,
  symbolName: string,
  options: DepsOptions = {}
): Promise<DepsResult | null> {
  const { direction = 'both', depth = 1 } = options;
  const allFileSymbols = await kb.getAllFileSymbols();

  const targetSymbol = findSymbol(allFileSymbols, symbolName);
  if (!targetSymbol) {
    return null;
  }

  const incoming: DependencyRef[] = [];
  const outgoing: DependencyRef[] = [];

  if (direction === 'out' || direction === 'both') {
    const outDeps = getOutgoingDependencies(targetSymbol.file, allFileSymbols, depth);
    outgoing.push(...outDeps);
  }

  if (direction === 'in' || direction === 'both') {
    const inDeps = getIncomingDependencies(targetSymbol.symbol, allFileSymbols, depth);
    incoming.push(...inDeps);
  }

  return {
    symbol: targetSymbol.symbol.name,
    namespace: targetSymbol.symbol.namespace,
    file: targetSymbol.file.relativePath,
    incoming,
    outgoing,
    incomingCount: incoming.length,
    outgoingCount: outgoing.length,
  };
}

function findSymbol(allFileSymbols: FileSymbols[], symbolName: string): SymbolLocation | null {
  const nameLower = symbolName.toLowerCase();

  for (const fileSymbols of allFileSymbols) {
    for (const symbol of fileSymbols.symbols) {
      if (symbol.name.toLowerCase() === nameLower) {
        return { symbol, file: fileSymbols };
      }
    }
  }

  return null;
}

function getOutgoingDependencies(
  targetFile: FileSymbols,
  allFileSymbols: FileSymbols[],
  depth: number
): DependencyRef[] {
  const refs: DependencyRef[] = [];
  const visited = new Set<string>();
  const toProcess: Array<{ types: string[]; currentDepth: number }> = [
    { types: targetFile.dependencies.types, currentDepth: 1 },
  ];

  while (toProcess.length > 0) {
    const { types, currentDepth } = toProcess.shift()!;

    for (const typeName of types) {
      if (visited.has(typeName)) continue;
      visited.add(typeName);

      for (const fileSymbols of allFileSymbols) {
        for (const symbol of fileSymbols.symbols) {
          if (symbol.name === typeName) {
            refs.push({
              symbol: symbol.name,
              file: fileSymbols.relativePath,
              namespace: symbol.namespace,
            });

            if (currentDepth < depth) {
              toProcess.push({
                types: fileSymbols.dependencies.types,
                currentDepth: currentDepth + 1,
              });
            }
          }
        }
      }
    }
  }

  return refs;
}

function getIncomingDependencies(
  targetSymbol: SymbolInfo,
  allFileSymbols: FileSymbols[],
  depth: number
): DependencyRef[] {
  const refs: DependencyRef[] = [];
  const visited = new Set<string>();
  const targetNames = new Set<string>([targetSymbol.name]);

  for (let d = 0; d < depth; d++) {
    const newTargets = new Set<string>();

    for (const fileSymbols of allFileSymbols) {
      const fileKey = fileSymbols.relativePath;
      if (visited.has(fileKey)) continue;

      const hasRef = fileSymbols.dependencies.types.some((t) => targetNames.has(t));
      if (!hasRef) continue;

      visited.add(fileKey);

      for (const symbol of fileSymbols.symbols) {
        refs.push({
          symbol: symbol.name,
          file: fileSymbols.relativePath,
          namespace: symbol.namespace,
        });
        newTargets.add(symbol.name);
      }
    }

    for (const name of newTargets) {
      targetNames.add(name);
    }
  }

  return refs;
}

export function formatDepsTree(deps: DepsResult): string {
  const lines: string[] = [];
  const ns = deps.namespace ? ` (${deps.namespace})` : '';

  lines.push(`${deps.symbol}${ns}`);

  if (deps.outgoing.length > 0) {
    lines.push('├── Depends on:');
    const outLimit = Math.min(deps.outgoing.length, 5);
    for (let i = 0; i < outLimit; i++) {
      const ref = deps.outgoing[i];
      const prefix = i === outLimit - 1 && deps.outgoing.length <= 5 ? '│   └── ' : '│   ├── ';
      lines.push(`${prefix}${ref.symbol}`);
    }
    if (deps.outgoing.length > 5) {
      lines.push(`│   └── ... (${deps.outgoingCount} total)`);
    }
  }

  if (deps.incoming.length > 0) {
    lines.push('└── Depended on by:');
    const inLimit = Math.min(deps.incoming.length, 5);
    for (let i = 0; i < inLimit; i++) {
      const ref = deps.incoming[i];
      const prefix = i === inLimit - 1 && deps.incoming.length <= 5 ? '    └── ' : '    ├── ';
      lines.push(`${prefix}${ref.symbol}`);
    }
    if (deps.incoming.length > 5) {
      lines.push(`    └── ... (${deps.incomingCount} total)`);
    }
  }

  return lines.join('\n');
}
