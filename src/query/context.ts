import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { FileSymbols, SymbolInfo } from '../knowledge-base/schema.js';
import type {
  ContextResult,
  ContextFile,
  InterfaceMapping,
  DependencyWarning,
} from './types.js';

export interface ContextOptions {
  maxFiles?: number;
  includeDeps?: boolean;
}

interface ScoredFile {
  fileSymbols: FileSymbols;
  score: number;
  matchedSymbols: string[];
  relevance: string[];
}

export async function generateContext(
  kb: KnowledgeBase,
  task: string,
  options: ContextOptions = {}
): Promise<ContextResult> {
  const { maxFiles = 10, includeDeps = false } = options;
  const allFileSymbols = await kb.getAllFileSymbols();

  const tokens = tokenize(task);
  const scored = scoreFiles(allFileSymbols, tokens);
  const topFiles = scored.slice(0, maxFiles);

  const contextFiles: ContextFile[] = topFiles.map((sf) => ({
    file: sf.fileSymbols.relativePath,
    symbols: sf.matchedSymbols,
    relevance: sf.relevance.join(', '),
    score: sf.score,
  }));

  const interfaceMap = buildInterfaceMap(allFileSymbols, topFiles);
  const warnings = generateWarnings(allFileSymbols, topFiles);
  const startingPoints = generateStartingPoints(topFiles, tokens);

  return {
    task,
    files: contextFiles,
    interfaceMap,
    warnings,
    startingPoints,
  };
}

function tokenize(task: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'it',
    'implement', 'add', 'create', 'make', 'build', 'fix', 'update',
  ]);

  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopWords.has(t));
}

function scoreFiles(allFileSymbols: FileSymbols[], tokens: string[]): ScoredFile[] {
  const scored: ScoredFile[] = [];

  for (const fileSymbols of allFileSymbols) {
    let score = 0;
    const matchedSymbols: string[] = [];
    const relevance: string[] = [];

    for (const symbol of fileSymbols.symbols) {
      const symbolScore = scoreSymbol(symbol, tokens);
      if (symbolScore.score > 0) {
        score += symbolScore.score;
        matchedSymbols.push(symbol.name);
        relevance.push(...symbolScore.reasons);
      }
    }

    if (score > 0) {
      scored.push({
        fileSymbols,
        score,
        matchedSymbols,
        relevance: [...new Set(relevance)],
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

function scoreSymbol(
  symbol: SymbolInfo,
  tokens: string[]
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const nameLower = symbol.name.toLowerCase();
  const nsLower = (symbol.namespace || '').toLowerCase();

  for (const token of tokens) {
    if (nameLower === token) {
      score += 10;
      reasons.push(`Exact match: "${token}"`);
    } else if (nameLower.includes(token)) {
      score += 5;
      reasons.push(`Contains "${token}"`);
    }

    if (nsLower.includes(token)) {
      score += 2;
      reasons.push(`Namespace contains "${token}"`);
    }

    if (symbol.members) {
      for (const member of symbol.members) {
        const memberLower = member.name.toLowerCase();
        if (memberLower === token) {
          score += 5;
          reasons.push(`Member match: "${token}"`);
        } else if (memberLower.includes(token)) {
          score += 3;
          reasons.push(`Member contains "${token}"`);
        }
      }
    }
  }

  return { score, reasons };
}

function buildInterfaceMap(
  allFileSymbols: FileSymbols[],
  topFiles: ScoredFile[]
): InterfaceMapping[] {
  const interfaces = new Map<string, string[]>();
  const relevantSymbols = new Set<string>();

  for (const sf of topFiles) {
    for (const symbol of sf.fileSymbols.symbols) {
      relevantSymbols.add(symbol.name);
      if (symbol.kind === 'interface') {
        interfaces.set(symbol.name, []);
      }
    }
  }

  for (const fileSymbols of allFileSymbols) {
    for (const symbol of fileSymbols.symbols) {
      if (symbol.bases) {
        for (const base of symbol.bases) {
          if (interfaces.has(base)) {
            interfaces.get(base)!.push(symbol.name);
          }
        }
      }
    }
  }

  return Array.from(interfaces.entries())
    .filter(([_, impls]) => impls.length > 0)
    .map(([iface, impls]) => ({
      interface: iface,
      implementations: impls,
    }));
}

function generateWarnings(
  allFileSymbols: FileSymbols[],
  topFiles: ScoredFile[]
): DependencyWarning[] {
  const warnings: DependencyWarning[] = [];
  const relevantSymbols = new Set<string>();

  for (const sf of topFiles) {
    for (const symbol of sf.fileSymbols.symbols) {
      relevantSymbols.add(symbol.name);
    }
  }

  const dependentCounts = new Map<string, number>();
  for (const fileSymbols of allFileSymbols) {
    for (const typeName of fileSymbols.dependencies.types) {
      if (relevantSymbols.has(typeName)) {
        dependentCounts.set(typeName, (dependentCounts.get(typeName) || 0) + 1);
      }
    }
  }

  for (const [symbol, count] of dependentCounts) {
    if (count >= 5) {
      warnings.push({
        symbol,
        dependentCount: count,
        message: `${symbol} has ${count} dependents - changes ripple widely`,
      });
    }
  }

  return warnings.sort((a, b) => b.dependentCount - a.dependentCount);
}

function generateStartingPoints(topFiles: ScoredFile[], tokens: string[]): string[] {
  const points: string[] = [];

  for (let i = 0; i < Math.min(3, topFiles.length); i++) {
    const sf = topFiles[i];
    const symbolNames = sf.matchedSymbols.slice(0, 2).join(', ');
    const relevance = sf.relevance[0] || 'relevant to task';
    points.push(`Look at \`${symbolNames}\` in ${sf.fileSymbols.relativePath} - ${relevance}`);
  }

  return points;
}

export function formatContextMarkdown(context: ContextResult): string {
  const lines: string[] = [];

  lines.push(`# Context: ${context.task}`);
  lines.push('');
  lines.push('## Relevant Files (ranked by relevance)');
  lines.push('');

  for (let i = 0; i < context.files.length; i++) {
    const file = context.files[i];
    lines.push(`### ${i + 1}. ${file.file}`);
    lines.push(`**Symbols:** ${file.symbols.join(', ')}`);
    lines.push(`**Relevance:** ${file.relevance}`);
    lines.push('');
  }

  if (context.interfaceMap.length > 0) {
    lines.push('## Interface Map');
    for (const mapping of context.interfaceMap) {
      lines.push(`- **${mapping.interface}** -> ${mapping.implementations.join(', ')}`);
    }
    lines.push('');
  }

  if (context.warnings.length > 0) {
    lines.push('## Dependency Warnings');
    for (const warning of context.warnings) {
      lines.push(`- **${warning.symbol}** has ${warning.dependentCount} dependents - changes ripple widely`);
    }
    lines.push('');
  }

  if (context.startingPoints.length > 0) {
    lines.push('## Suggested Starting Points');
    for (let i = 0; i < context.startingPoints.length; i++) {
      lines.push(`${i + 1}. ${context.startingPoints[i]}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
