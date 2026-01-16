import { createJsonArrayStream } from '../streaming/json-stream.js';
import { getValueAtPath, getValuesAtPath } from './path-query.js';
import { findRelationships } from '../analyzer/relationship-finder.js';
import { logger } from '../utils/logger.js';

export interface JoinOptions {
  leftKey?: string;
  rightKey?: string;
  select?: string[];
  filter?: string;
  limit?: number;
}

export interface JoinResult<T = unknown> {
  items: T[];
  totalMatched: number;
  leftScanned: number;
  rightScanned: number;
  joinKeys: {
    leftKey: string;
    rightKey: string;
    autoDetected: boolean;
  };
}

interface FilterCondition {
  path: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'exists';
  value: unknown;
  side: 'a' | 'b' | null;
}

function parseJoinFilter(filter: string): FilterCondition | null {
  const operatorPatterns = [
    { op: '>=', regex: /^(.+?)\s*>=\s*(.+)$/ },
    { op: '<=', regex: /^(.+?)\s*<=\s*(.+)$/ },
    { op: '!=', regex: /^(.+?)\s*!=\s*(.+)$/ },
    { op: '=', regex: /^(.+?)\s*=\s*(.+)$/ },
    { op: '>', regex: /^(.+?)\s*>\s*(.+)$/ },
    { op: '<', regex: /^(.+?)\s*<\s*(.+)$/ },
    { op: 'contains', regex: /^(.+?)\s+contains\s+(.+)$/i },
    { op: 'startsWith', regex: /^(.+?)\s+startsWith\s+(.+)$/i },
    { op: 'endsWith', regex: /^(.+?)\s+endsWith\s+(.+)$/i },
    { op: 'exists', regex: /^(.+?)\s+exists$/i },
  ];

  for (const { op, regex } of operatorPatterns) {
    const match = filter.match(regex);
    if (match) {
      let pathStr = match[1].trim();
      const valueStr = op === 'exists' ? 'true' : match[2].trim();
      let value: unknown = valueStr;

      let side: 'a' | 'b' | null = null;
      if (pathStr.startsWith('a.')) {
        side = 'a';
        pathStr = pathStr.slice(2);
      } else if (pathStr.startsWith('b.')) {
        side = 'b';
        pathStr = pathStr.slice(2);
      }

      if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
        value = valueStr.slice(1, -1);
      } else if (valueStr === 'true') {
        value = true;
      } else if (valueStr === 'false') {
        value = false;
      } else if (valueStr === 'null') {
        value = null;
      } else if (!isNaN(Number(valueStr))) {
        value = Number(valueStr);
      }

      return {
        path: pathStr,
        operator: op as FilterCondition['operator'],
        value,
        side,
      };
    }
  }

  return null;
}

function compareValues(actual: unknown, operator: FilterCondition['operator'], expected: unknown): boolean {
  switch (operator) {
    case '=':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected);
      }
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return false;
    case 'startsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'endsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case '>':
    case '<':
    case '>=':
    case '<=': {
      if (typeof actual === 'number' && typeof expected === 'number') {
        switch (operator) {
          case '>': return actual > expected;
          case '<': return actual < expected;
          case '>=': return actual >= expected;
          case '<=': return actual <= expected;
        }
      }
      return false;
    }
  }
}

function matchesJoinFilter(
  left: unknown,
  right: unknown,
  condition: FilterCondition
): boolean {
  let targetObj: unknown;
  if (condition.side === 'a') {
    targetObj = left;
  } else if (condition.side === 'b') {
    targetObj = right;
  } else {
    const leftValues = getValuesAtPath(left, condition.path);
    const rightValues = getValuesAtPath(right, condition.path);
    const values = [...leftValues, ...rightValues];

    if (condition.operator === 'exists') {
      return values.length > 0 && values.some(v => v !== undefined && v !== null);
    }
    return values.some(v => compareValues(v, condition.operator, condition.value));
  }

  const values = getValuesAtPath(targetObj, condition.path);

  if (condition.operator === 'exists') {
    return values.length > 0 && values.some(v => v !== undefined && v !== null);
  }

  return values.some(v => compareValues(v, condition.operator, condition.value));
}

function extractJoinFields(
  left: unknown,
  right: unknown,
  select: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of select) {
    let side: 'a' | 'b' | null = null;
    let pathStr = field;

    if (field.startsWith('a.')) {
      side = 'a';
      pathStr = field.slice(2);
    } else if (field.startsWith('b.')) {
      side = 'b';
      pathStr = field.slice(2);
    }

    const fieldName = pathStr.split('.').pop() || pathStr;

    if (pathStr.endsWith('.length')) {
      const basePath = pathStr.replace('.length', '');
      const targetObj = side === 'a' ? left : side === 'b' ? right : left;
      const arr = getValueAtPath(targetObj, basePath);
      result[fieldName] = Array.isArray(arr) ? arr.length : 0;
    } else {
      const targetObj = side === 'a' ? left : side === 'b' ? right : left;
      result[fieldName] = getValueAtPath(targetObj, pathStr);
    }
  }

  return result;
}

async function buildRightIndex(
  filePath: string,
  keyPath: string
): Promise<{ index: Map<string, unknown[]>; scanned: number }> {
  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });
  const index = new Map<string, unknown[]>();
  let scanned = 0;

  for await (const { value } of stream) {
    scanned++;

    const keyValue = getValueAtPath(value, keyPath);
    if (keyValue !== undefined && keyValue !== null) {
      const key = String(keyValue);
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key)!.push(value);
    }
  }

  return { index, scanned };
}

export async function executeJoin<T = unknown>(
  leftFile: string,
  rightFile: string,
  options: JoinOptions = {}
): Promise<JoinResult<T>> {
  let { leftKey, rightKey } = options;
  const { select, filter, limit = 100 } = options;
  let autoDetected = false;

  if (!leftKey || !rightKey) {
    logger.debug('Auto-detecting relationship between files');

    const relationshipResult = await findRelationships(leftFile, rightFile, { minCoverage: 30 });

    if (relationshipResult.relationships.length === 0) {
      throw new Error('No relationship detected between files. Please specify --left-key and --right-key explicitly.');
    }

    const bestMatch = relationshipResult.relationships[0];
    leftKey = bestMatch.leftPath;
    rightKey = bestMatch.rightPath;
    autoDetected = true;

    logger.debug(`Auto-detected join keys: ${leftKey} -> ${rightKey}`);
  }

  let filterCondition: FilterCondition | null = null;
  if (filter) {
    filterCondition = parseJoinFilter(filter);
    if (!filterCondition) {
      logger.warn(`Invalid filter expression: ${filter}`);
    }
  }

  logger.debug(`Building index on right file: ${rightKey}`);
  const { index: rightIndex, scanned: rightScanned } = await buildRightIndex(rightFile, rightKey);
  logger.debug(`Built index with ${rightIndex.size} unique keys from ${rightScanned} entities`);

  const leftStream = createJsonArrayStream<unknown>(leftFile, { pickPath: 'entities' });

  const items: T[] = [];
  let totalMatched = 0;
  let leftScanned = 0;

  logger.debug(`Scanning left file with key: ${leftKey}`);

  for await (const { value: leftEntity } of leftStream) {
    leftScanned++;

    const leftKeys = getValuesAtPath(leftEntity, leftKey);

    for (const lk of leftKeys) {
      if (lk === undefined || lk === null) continue;

      const keyStr = String(lk);
      const rightMatches = rightIndex.get(keyStr) ?? [];

      for (const rightEntity of rightMatches) {
        if (filterCondition && !matchesJoinFilter(leftEntity, rightEntity, filterCondition)) {
          continue;
        }

        totalMatched++;

        if (items.length >= limit) {
          continue;
        }

        if (select && select.length > 0) {
          items.push(extractJoinFields(leftEntity, rightEntity, select) as T);
        } else {
          items.push({
            left: leftEntity,
            right: rightEntity,
          } as T);
        }
      }
    }
  }

  logger.debug(`Join complete: scanned ${leftScanned} left, ${rightScanned} right, matched ${totalMatched}`);

  return {
    items,
    totalMatched,
    leftScanned,
    rightScanned,
    joinKeys: {
      leftKey,
      rightKey,
      autoDetected,
    },
  };
}

export function formatJoinResults<T>(result: JoinResult<T>): string {
  const lines: string[] = [];

  lines.push(`# Join Results`);
  lines.push(`${result.items.length} results (${result.totalMatched} total matches)`);
  lines.push(`Join: ${result.joinKeys.leftKey} -> ${result.joinKeys.rightKey}${result.joinKeys.autoDetected ? ' (auto-detected)' : ''}`);
  lines.push(`Scanned: ${result.leftScanned} left, ${result.rightScanned} right`);
  lines.push('');

  if (result.items.length > 0) {
    lines.push(JSON.stringify(result.items, null, 2));
  } else {
    lines.push('No matching results.');
  }

  return lines.join('\n');
}
