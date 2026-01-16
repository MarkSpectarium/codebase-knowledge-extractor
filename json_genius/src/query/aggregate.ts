import { createJsonArrayStream } from '../streaming/json-stream.js';
import { getValueAtPath, getValuesAtPath } from './path-query.js';
import { logger } from '../utils/logger.js';

export interface AggregateOptions {
  path: string;
  filter?: string;
}

export interface CountResult {
  total: number;
  scanned: number;
}

export interface GroupByResult {
  groups: Record<string, number>;
  total: number;
  uniqueValues: number;
  scanned: number;
}

export interface StatsResult {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  scanned: number;
}

export interface DistributionBucket {
  range: string;
  count: number;
  percentage: number;
}

export interface DistributionResult {
  buckets: DistributionBucket[];
  total: number;
  scanned: number;
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
 * Counts items matching an optional filter.
 */
export async function count(
  filePath: string,
  options: Partial<AggregateOptions> = {}
): Promise<CountResult> {
  const { filter } = options;

  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });

  let filterCondition: FilterCondition | null = null;
  if (filter) {
    filterCondition = parseFilter(filter);
  }

  let total = 0;
  let scanned = 0;

  logger.debug(`Counting with filter: ${filter || 'none'}`);

  for await (const { value } of stream) {
    scanned++;

    if (filterCondition && !matchesFilter(value, filterCondition)) {
      continue;
    }

    total++;
  }

  logger.debug(`Count complete: ${total} of ${scanned}`);

  return { total, scanned };
}

/**
 * Groups items by a field value and counts occurrences.
 */
export async function groupBy(
  filePath: string,
  options: AggregateOptions
): Promise<GroupByResult> {
  const { path, filter } = options;

  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });

  let filterCondition: FilterCondition | null = null;
  if (filter) {
    filterCondition = parseFilter(filter);
  }

  const groups: Record<string, number> = {};
  let total = 0;
  let scanned = 0;

  logger.debug(`Grouping by ${path} with filter: ${filter || 'none'}`);

  for await (const { value } of stream) {
    scanned++;

    if (filterCondition && !matchesFilter(value, filterCondition)) {
      continue;
    }

    const values = getValuesAtPath(value, path);

    for (const v of values) {
      const key = v === null ? 'null' : v === undefined ? 'undefined' : String(v);
      groups[key] = (groups[key] || 0) + 1;
      total++;
    }
  }

  logger.debug(`GroupBy complete: ${Object.keys(groups).length} unique values, ${total} total`);

  return {
    groups,
    total,
    uniqueValues: Object.keys(groups).length,
    scanned,
  };
}

/**
 * Calculates statistics for a numeric field.
 */
export async function stats(
  filePath: string,
  options: AggregateOptions
): Promise<StatsResult> {
  const { path, filter } = options;

  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });

  let filterCondition: FilterCondition | null = null;
  if (filter) {
    filterCondition = parseFilter(filter);
  }

  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let scanned = 0;

  logger.debug(`Calculating stats for ${path} with filter: ${filter || 'none'}`);

  for await (const { value } of stream) {
    scanned++;

    if (filterCondition && !matchesFilter(value, filterCondition)) {
      continue;
    }

    const values = getValuesAtPath(value, path);

    for (const v of values) {
      if (typeof v === 'number' && !isNaN(v)) {
        count++;
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }

  const avg = count > 0 ? sum / count : 0;

  logger.debug(`Stats complete: count=${count}, avg=${avg.toFixed(2)}`);

  return {
    count,
    sum,
    avg,
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    scanned,
  };
}

/**
 * Creates a distribution of numeric values into buckets.
 */
export async function distribution(
  filePath: string,
  options: AggregateOptions & { buckets?: number }
): Promise<DistributionResult> {
  const { path, filter, buckets: bucketCount = 10 } = options;

  const statsResult = await stats(filePath, { path, filter });

  if (statsResult.count === 0) {
    return {
      buckets: [],
      total: 0,
      scanned: statsResult.scanned,
    };
  }

  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });

  let filterCondition: FilterCondition | null = null;
  if (filter) {
    filterCondition = parseFilter(filter);
  }

  const { min, max } = statsResult;
  const bucketSize = (max - min) / bucketCount || 1;
  const counts: number[] = new Array(bucketCount).fill(0);
  let total = 0;
  let scanned = 0;

  for await (const { value } of stream) {
    scanned++;

    if (filterCondition && !matchesFilter(value, filterCondition)) {
      continue;
    }

    const values = getValuesAtPath(value, path);

    for (const v of values) {
      if (typeof v === 'number' && !isNaN(v)) {
        const bucketIndex = Math.min(Math.floor((v - min) / bucketSize), bucketCount - 1);
        counts[bucketIndex]++;
        total++;
      }
    }
  }

  const buckets: DistributionBucket[] = counts.map((count, i) => {
    const rangeStart = min + i * bucketSize;
    const rangeEnd = min + (i + 1) * bucketSize;
    return {
      range: `${rangeStart.toFixed(1)}-${rangeEnd.toFixed(1)}`,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    };
  });

  return { buckets, total, scanned };
}

/**
 * Formats group-by results for display.
 */
export function formatGroupByResult(result: GroupByResult, sortBy: 'key' | 'count' = 'count'): string {
  const lines: string[] = [
    `# Group By Results`,
    `Total: ${result.total} | Unique Values: ${result.uniqueValues} | Scanned: ${result.scanned}`,
    '',
  ];

  const entries = Object.entries(result.groups);

  if (sortBy === 'count') {
    entries.sort((a, b) => b[1] - a[1]);
  } else {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  }

  const maxKeyLen = Math.max(...entries.map(([k]) => k.length), 5);
  const maxCountLen = Math.max(...entries.map(([, v]) => String(v).length), 5);

  lines.push(`${'Value'.padEnd(maxKeyLen)} | ${'Count'.padStart(maxCountLen)} | Percentage`);
  lines.push(`${'-'.repeat(maxKeyLen)}-+-${'-'.repeat(maxCountLen)}-+-----------`);

  for (const [key, count] of entries) {
    const pct = ((count / result.total) * 100).toFixed(1);
    lines.push(`${key.padEnd(maxKeyLen)} | ${String(count).padStart(maxCountLen)} | ${pct}%`);
  }

  return lines.join('\n');
}

/**
 * Formats stats results for display.
 */
export function formatStatsResult(result: StatsResult): string {
  return [
    `# Statistics`,
    `Count: ${result.count}`,
    `Sum: ${result.sum.toFixed(2)}`,
    `Average: ${result.avg.toFixed(2)}`,
    `Min: ${result.min}`,
    `Max: ${result.max}`,
    `Scanned: ${result.scanned}`,
  ].join('\n');
}

/**
 * Formats distribution results for display.
 */
export function formatDistributionResult(result: DistributionResult): string {
  const lines: string[] = [
    `# Distribution`,
    `Total: ${result.total} | Scanned: ${result.scanned}`,
    '',
  ];

  const maxRangeLen = Math.max(...result.buckets.map(b => b.range.length), 5);
  const maxCountLen = Math.max(...result.buckets.map(b => String(b.count).length), 5);

  lines.push(`${'Range'.padEnd(maxRangeLen)} | ${'Count'.padStart(maxCountLen)} | Distribution`);
  lines.push(`${'-'.repeat(maxRangeLen)}-+-${'-'.repeat(maxCountLen)}-+-------------`);

  for (const bucket of result.buckets) {
    const barLength = Math.round(bucket.percentage / 2);
    const bar = '#'.repeat(barLength);
    lines.push(`${bucket.range.padEnd(maxRangeLen)} | ${String(bucket.count).padStart(maxCountLen)} | ${bar} ${bucket.percentage.toFixed(1)}%`);
  }

  return lines.join('\n');
}
