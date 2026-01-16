import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { FileSymbols, SymbolInfo, MemberInfo } from '../knowledge-base/schema.js';

export interface RelevantFile {
  path: string;
  absolutePath: string;
  line?: number;
  symbol?: string;
  relevance: string;
  snippet?: string;
}

export interface SymbolRef {
  name: string;
  kind: string;
  file: string;
  line: number;
}

export interface ChatResponse {
  answer: string;
  files: RelevantFile[];
  relatedSymbols?: SymbolRef[];
  suggestedQuestions?: string[];
}

interface ScoredMatch {
  fileSymbols: FileSymbols;
  symbol: SymbolInfo;
  member?: MemberInfo;
  score: number;
  relevance: string;
}

export async function processQuestion(
  kb: KnowledgeBase,
  question: string
): Promise<ChatResponse> {
  const meta = await kb.readMeta();
  const rootPath = meta?.rootPath || '';

  const tokens = tokenize(question);
  const allFileSymbols = await kb.getAllFileSymbols();

  const matches = scoreMatches(allFileSymbols, tokens);
  const topMatches = matches.slice(0, 10);

  const files = topMatches.map((m): RelevantFile => {
    const path = m.fileSymbols.relativePath;
    const line = m.member?.line || m.symbol.line;
    const symbolName = m.member
      ? `${m.symbol.name}.${m.member.name}`
      : m.symbol.name;

    return {
      path,
      absolutePath: joinPath(rootPath, path),
      line,
      symbol: symbolName,
      relevance: m.relevance,
      snippet: getSnippet(m.symbol, m.member),
    };
  });

  const relatedSymbols = collectRelatedSymbols(topMatches);
  const answer = generateAnswer(question, topMatches, tokens);
  const suggestedQuestions = generateSuggestions(topMatches, tokens);

  return {
    answer,
    files,
    relatedSymbols,
    suggestedQuestions,
  };
}

function tokenize(question: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'it',
    'where', 'what', 'how', 'why', 'when', 'which', 'who',
    'find', 'show', 'get', 'list', 'tell', 'me', 'about',
  ]);

  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));
}

function scoreMatches(allFileSymbols: FileSymbols[], tokens: string[]): ScoredMatch[] {
  const matches: ScoredMatch[] = [];

  for (const fileSymbols of allFileSymbols) {
    for (const symbol of fileSymbols.symbols) {
      const symbolResult = scoreSymbol(symbol, tokens);

      if (symbolResult.score > 0) {
        matches.push({
          fileSymbols,
          symbol,
          score: symbolResult.score,
          relevance: symbolResult.relevance,
        });
      }

      if (symbol.members) {
        for (const member of symbol.members) {
          const memberResult = scoreMember(symbol, member, tokens);
          if (memberResult.score > 0) {
            matches.push({
              fileSymbols,
              symbol,
              member,
              score: memberResult.score,
              relevance: memberResult.relevance,
            });
          }
        }
      }
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function scoreSymbol(
  symbol: SymbolInfo,
  tokens: string[]
): { score: number; relevance: string } {
  let score = 0;
  const reasons: string[] = [];
  const nameLower = symbol.name.toLowerCase();
  const nameParts = splitCamelCase(symbol.name);

  for (const token of tokens) {
    if (nameLower === token) {
      score += 20;
      reasons.push(`Exact match: ${symbol.name}`);
    } else if (nameLower.includes(token)) {
      score += 10;
      reasons.push(`Contains "${token}"`);
    } else if (nameParts.some((p) => p.toLowerCase() === token)) {
      score += 8;
      reasons.push(`Name part match: "${token}"`);
    }

    if (symbol.namespace?.toLowerCase().includes(token)) {
      score += 3;
      reasons.push(`Namespace: ${symbol.namespace}`);
    }
  }

  return { score, relevance: reasons.join(', ') || 'No direct match' };
}

function scoreMember(
  symbol: SymbolInfo,
  member: MemberInfo,
  tokens: string[]
): { score: number; relevance: string } {
  let score = 0;
  const reasons: string[] = [];
  const memberLower = member.name.toLowerCase();
  const memberParts = splitCamelCase(member.name);

  for (const token of tokens) {
    if (memberLower === token) {
      score += 15;
      reasons.push(`Member match: ${member.name}`);
    } else if (memberLower.includes(token)) {
      score += 7;
      reasons.push(`Member contains "${token}"`);
    } else if (memberParts.some((p) => p.toLowerCase() === token)) {
      score += 5;
      reasons.push(`Member part: "${token}"`);
    }

    if (member.signature?.toLowerCase().includes(token)) {
      score += 4;
      reasons.push(`Signature contains "${token}"`);
    }
  }

  return { score, relevance: reasons.join(', ') || 'No direct match' };
}

function splitCamelCase(name: string): string[] {
  return name.split(/(?=[A-Z])/).filter((p) => p.length > 0);
}

function getSnippet(symbol: SymbolInfo, member?: MemberInfo): string | undefined {
  if (member) {
    if (member.signature) {
      return member.signature;
    }
    return `${member.kind}: ${member.name}`;
  }

  const bases = symbol.bases?.length
    ? ` : ${symbol.bases.join(', ')}`
    : '';
  return `${symbol.kind} ${symbol.name}${bases}`;
}

function collectRelatedSymbols(matches: ScoredMatch[]): SymbolRef[] {
  const seen = new Set<string>();
  const refs: SymbolRef[] = [];

  for (const match of matches.slice(0, 5)) {
    const key = `${match.symbol.name}:${match.fileSymbols.relativePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({
        name: match.symbol.name,
        kind: match.symbol.kind,
        file: match.fileSymbols.relativePath,
        line: match.symbol.line,
      });
    }
  }

  return refs;
}

function generateAnswer(
  question: string,
  matches: ScoredMatch[],
  tokens: string[]
): string {
  if (matches.length === 0) {
    return `No results found for your query. Try different keywords or check if the codebase has been indexed.`;
  }

  const topMatch = matches[0];
  const symbolName = topMatch.member
    ? `${topMatch.symbol.name}.${topMatch.member.name}`
    : topMatch.symbol.name;

  const keyTerms = tokens.slice(0, 3).join(', ');
  const fileCount = new Set(matches.slice(0, 10).map((m) => m.fileSymbols.relativePath)).size;

  let answer = `Found ${matches.length} results related to "${keyTerms}".\n\n`;
  answer += `The most relevant match is **${symbolName}** in \`${topMatch.fileSymbols.relativePath}\``;

  if (topMatch.relevance) {
    answer += ` (${topMatch.relevance})`;
  }
  answer += '.';

  if (fileCount > 1) {
    answer += `\n\nResults span ${fileCount} files. Click on file links below to explore.`;
  }

  return answer;
}

function generateSuggestions(matches: ScoredMatch[], tokens: string[]): string[] {
  const suggestions: string[] = [];
  const seenBases = new Set<string>();

  for (const match of matches.slice(0, 5)) {
    if (match.symbol.bases) {
      for (const base of match.symbol.bases) {
        if (!seenBases.has(base)) {
          seenBases.add(base);
          suggestions.push(`What classes inherit from ${base}?`);
        }
      }
    }

    if (match.symbol.namespace && suggestions.length < 3) {
      const ns = match.symbol.namespace.split('.').slice(0, 2).join('.');
      suggestions.push(`What other classes are in the ${ns} namespace?`);
    }
  }

  return suggestions.slice(0, 3);
}

function joinPath(root: string, relative: string): string {
  if (!root) return relative;
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRelative = relative.replace(/\\/g, '/').replace(/^\//, '');
  return `${normalizedRoot}/${normalizedRelative}`;
}
