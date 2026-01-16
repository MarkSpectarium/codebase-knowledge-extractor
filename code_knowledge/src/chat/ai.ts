import type { KnowledgeBase } from '../knowledge-base/index.js';
import type { ChatResponse, RelevantFile, SymbolRef } from './processor.js';
import { processQuestion } from './processor.js';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
}

export function isAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function processWithAi(
  kb: KnowledgeBase,
  question: string
): Promise<ChatResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return processQuestion(kb, question);
  }

  const keywordResponse = await processQuestion(kb, question);
  const context = buildContext(keywordResponse);

  try {
    const aiAnswer = await queryClaudeApi(apiKey, question, context);

    return {
      ...keywordResponse,
      answer: aiAnswer,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ...keywordResponse,
      answer: `${keywordResponse.answer}\n\n(AI enhancement unavailable: ${errorMessage})`,
    };
  }
}

function buildContext(response: ChatResponse): string {
  const lines: string[] = [];

  lines.push('## Relevant Files Found');
  for (const file of response.files.slice(0, 8)) {
    lines.push(`- ${file.path}:${file.line || 1} - ${file.symbol || 'unknown'}`);
    if (file.snippet) {
      lines.push(`  Snippet: ${file.snippet}`);
    }
    if (file.relevance) {
      lines.push(`  Relevance: ${file.relevance}`);
    }
  }

  if (response.relatedSymbols && response.relatedSymbols.length > 0) {
    lines.push('\n## Related Symbols');
    for (const sym of response.relatedSymbols) {
      lines.push(`- ${sym.name} (${sym.kind}) in ${sym.file}:${sym.line}`);
    }
  }

  return lines.join('\n');
}

async function queryClaudeApi(
  apiKey: string,
  question: string,
  context: string
): Promise<string> {
  const systemPrompt = `You are a helpful assistant that answers questions about a codebase.
You have access to a knowledge base containing indexed symbols, classes, methods, and their relationships.
When referencing code, always mention the file path and line number in the format: path/to/file.cs:123
Keep your answers concise and focused on the user's question.
If the context doesn't contain enough information, say so honestly.`;

  const userMessage = `Question: ${question}

Context from knowledge base:
${context}

Please answer the question based on the provided context. Reference specific files and line numbers when relevant.`;

  const requestBody = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: userMessage },
    ] as ClaudeMessage[],
    system: systemPrompt,
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const textContent = data.content.find((c) => c.type === 'text');

  return textContent?.text || 'No response from AI.';
}

export function formatFilesForDisplay(files: RelevantFile[]): string {
  return files
    .map((f) => {
      const location = f.line ? `${f.path}:${f.line}` : f.path;
      const symbol = f.symbol ? ` - ${f.symbol}` : '';
      return `${location}${symbol}`;
    })
    .join('\n');
}

export function formatSymbolsForDisplay(symbols: SymbolRef[]): string {
  return symbols
    .map((s) => `${s.name} (${s.kind}) - ${s.file}:${s.line}`)
    .join('\n');
}
