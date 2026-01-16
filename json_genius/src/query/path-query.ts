import { createJsonArrayStream } from '../streaming/json-stream.js';
import { logger } from '../utils/logger.js';

export interface QueryOptions {
  select?: string[];
  filter?: string;
  limit?: number;
  offset?: number;
}

export interface QueryResult<T = unknown> {
  items: T[];
  totalMatched: number;
  totalScanned: number;
}

interface PathSegment {
  type: 'key' | 'wildcard' | 'index';
  key: string;
  index: number;
}

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const regex = /([^.\[\]]+)|\[(\*|\d+)\]/g;
  let match;

  while ((match = regex.exec(path)) !== null) {
    if (match[1]) {
      segments.push({ type: 'key', key: match[1], index: 0 });
    } else if (match[2] === '*') {
      segments.push({ type: 'wildcard', key: '', index: 0 });
    } else if (match[2]) {
      segments.push({ type: 'index', key: '', index: parseInt(match[2], 10) });
    }
  }

  return segments;
}

/**
 * Gets a single value at a path (returns first match).
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
  const values = getValuesAtPath(obj, path);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Gets all values at a path (handles wildcards).
 */
export function getValuesAtPath(obj: unknown, path: string): unknown[] {
  const segments = parsePath(path);
  let current: unknown[] = [obj];

  for (const segment of segments) {
    const next: unknown[] = [];

    for (const item of current) {
      if (item === null || item === undefined) {
        continue;
      }

      if (segment.type === 'key') {
        if (typeof item === 'object' && segment.key in (item as Record<string, unknown>)) {
          next.push((item as Record<string, unknown>)[segment.key]);
        }
      } else if (segment.type === 'wildcard') {
        if (Array.isArray(item)) {
          next.push(...item);
        } else if (typeof item === 'object') {
          next.push(...Object.values(item as Record<string, unknown>));
        }
      } else if (segment.type === 'index') {
        if (Array.isArray(item) && segment.index < item.length) {
          next.push(item[segment.index]);
        }
      }
    }

    current = next;
    if (current.length === 0) {
      break;
    }
  }

  return current;
}

interface FilterCondition {
  path: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'exists';
  value: unknown;
}

function parseFilter(filter: string): FilterCondition | null {
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
      const path = match[1].trim();
      const valueStr = op === 'exists' ? 'true' : match[2].trim();
      let value: unknown = valueStr;

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
        path,
        operator: op as FilterCondition['operator'],
        value,
      };
    }
  }

  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  if (typeof value === 'number') {
    return new Date(value);
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
      const actualDate = parseDate(actual);
      const expectedDate = parseDate(expected);

      if (actualDate && expectedDate) {
        const actualTime = actualDate.getTime();
        const expectedTime = expectedDate.getTime();
        switch (operator) {
          case '>': return actualTime > expectedTime;
          case '<': return actualTime < expectedTime;
          case '>=': return actualTime >= expectedTime;
          case '<=': return actualTime <= expectedTime;
        }
      }

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

function matchesFilter(obj: unknown, condition: FilterCondition): boolean {
  const values = getValuesAtPath(obj, condition.path);

  if (condition.operator === 'exists') {
    return values.length > 0 && values.some(v => v !== undefined && v !== null);
  }

  return values.some(v => compareValues(v, condition.operator, condition.value));
}

/**
 * Extracts selected fields from an object.
 */
function extractFields(obj: unknown, select: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of select) {
    const fieldName = field.split('.').pop() || field;
    const value = getValueAtPath(obj, field);

    if (field.endsWith('.length') && Array.isArray(getValueAtPath(obj, field.replace('.length', '')))) {
      const arr = getValueAtPath(obj, field.replace('.length', ''));
      result[fieldName] = Array.isArray(arr) ? arr.length : 0;
    } else {
      result[fieldName] = value;
    }
  }

  return result;
}

/**
 * Executes a path-based query on a JSON file.
 * Supports filtering, field selection, and pagination.
 */
export async function executeQuery<T = unknown>(
  filePath: string,
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  const {
    select,
    filter,
    limit = 100,
    offset = 0,
  } = options;

  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });

  let filterCondition: FilterCondition | null = null;
  if (filter) {
    filterCondition = parseFilter(filter);
    if (!filterCondition) {
      logger.warn(`Invalid filter expression: ${filter}`);
    }
  }

  const items: T[] = [];
  let totalMatched = 0;
  let totalScanned = 0;

  logger.debug(`Executing query with filter: ${filter || 'none'}, select: ${select?.join(', ') || '*'}`);

  for await (const { value } of stream) {
    totalScanned++;

    if (filterCondition && !matchesFilter(value, filterCondition)) {
      continue;
    }

    totalMatched++;

    if (totalMatched <= offset) {
      continue;
    }

    if (items.length >= limit) {
      continue;
    }

    if (select && select.length > 0) {
      items.push(extractFields(value, select) as T);
    } else {
      items.push(value as T);
    }
  }

  logger.debug(`Query complete: scanned ${totalScanned}, matched ${totalMatched}, returned ${items.length}`);

  return {
    items,
    totalMatched,
    totalScanned,
  };
}

/**
 * Formats query results for display.
 */
export function formatQueryResults<T>(result: QueryResult<T>, format: 'json' | 'table' | 'lines' = 'json'): string {
  const header = `# ${result.items.length} results (${result.totalMatched} total matches, ${result.totalScanned} scanned)\n\n`;

  if (format === 'json') {
    return JSON.stringify(result.items, null, 2);
  }

  if (format === 'lines') {
    return result.items.map(item => JSON.stringify(item)).join('\n');
  }

  if (format === 'table' && result.items.length > 0 && typeof result.items[0] === 'object') {
    const first = result.items[0] as Record<string, unknown>;
    const keys = Object.keys(first);
    const maxWidths = keys.map(k => Math.max(k.length, 15));

    const headerRow = keys.map((k, i) => k.padEnd(maxWidths[i])).join(' | ');
    const separator = keys.map((_, i) => '-'.repeat(maxWidths[i])).join('-+-');

    const rows = result.items.map(item => {
      const obj = item as Record<string, unknown>;
      return keys.map((k, i) => {
        const val = obj[k];
        const str = val === undefined ? '' : String(val);
        return str.slice(0, maxWidths[i]).padEnd(maxWidths[i]);
      }).join(' | ');
    });

    return header + headerRow + '\n' + separator + '\n' + rows.join('\n');
  }

  return header + JSON.stringify(result.items, null, 2);
}
