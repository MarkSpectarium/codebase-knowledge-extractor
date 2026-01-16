import { getValueAtPath, getValuesAtPath } from './path-query.js';

export type AggregateFunctionName = 'COUNT' | 'COUNT_IF' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'D1_RETENTION' | 'D7_RETENTION';

export interface ParsedAggregate {
  alias: string;
  func: AggregateFunctionName;
  arg: string;
}

export interface AggregateAccumulator {
  count: number;
  sum: number;
  min: number;
  max: number;
  conditionCount: number;
}

export function createAccumulator(): AggregateAccumulator {
  return {
    count: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    conditionCount: 0,
  };
}

const AGGREGATE_REGEX = /^(COUNT|SUM|AVG|MIN|MAX|COUNT_IF|D1_RETENTION|D7_RETENTION)\((.+)\)$/i;

export function parseAggregateExpression(expr: string): ParsedAggregate | null {
  const match = expr.match(AGGREGATE_REGEX);
  if (!match) {
    return null;
  }

  const func = match[1].toUpperCase() as AggregateFunctionName;
  const arg = match[2].trim();

  return { alias: '', func, arg };
}

export function parseAggregateMap(aggregates: Record<string, string>): ParsedAggregate[] {
  const result: ParsedAggregate[] = [];

  for (const [alias, expr] of Object.entries(aggregates)) {
    const parsed = parseAggregateExpression(expr);
    if (parsed) {
      parsed.alias = alias;
      result.push(parsed);
    }
  }

  return result;
}

function extractPathWithSide(
  path: string,
  left: unknown,
  right: unknown
): unknown {
  let targetObj: unknown;
  let actualPath = path;

  if (path.startsWith('a.')) {
    targetObj = left;
    actualPath = path.slice(2);
  } else if (path.startsWith('b.')) {
    targetObj = right;
    actualPath = path.slice(2);
  } else {
    targetObj = left;
  }

  return getValueAtPath(targetObj, actualPath);
}

function extractPathValuesWithSide(
  path: string,
  left: unknown,
  right: unknown
): unknown[] {
  let targetObj: unknown;
  let actualPath = path;

  if (path.startsWith('a.')) {
    targetObj = left;
    actualPath = path.slice(2);
  } else if (path.startsWith('b.')) {
    targetObj = right;
    actualPath = path.slice(2);
  } else {
    targetObj = left;
  }

  return getValuesAtPath(targetObj, actualPath);
}

function calculateRetention(loginHistory: unknown[], minDays: number): boolean {
  if (!Array.isArray(loginHistory) || loginHistory.length < 2) {
    return false;
  }

  const timestamps: number[] = [];
  for (const entry of loginHistory) {
    let ts: number | null = null;

    if (typeof entry === 'number') {
      ts = entry;
    } else if (typeof entry === 'string') {
      const date = new Date(entry);
      if (!isNaN(date.getTime())) {
        ts = date.getTime();
      }
    } else if (typeof entry === 'object' && entry !== null) {
      const dateVal = (entry as Record<string, unknown>).date ||
                      (entry as Record<string, unknown>).timestamp ||
                      (entry as Record<string, unknown>).time;
      if (typeof dateVal === 'number') {
        ts = dateVal;
      } else if (typeof dateVal === 'string') {
        const date = new Date(dateVal);
        if (!isNaN(date.getTime())) {
          ts = date.getTime();
        }
      }
    }

    if (ts !== null) {
      timestamps.push(ts);
    }
  }

  if (timestamps.length < 2) {
    return false;
  }

  timestamps.sort((a, b) => a - b);

  const firstLogin = timestamps[0];
  const minRetentionMs = minDays * 24 * 60 * 60 * 1000;

  for (let i = 1; i < timestamps.length; i++) {
    const daysDiff = timestamps[i] - firstLogin;
    if (daysDiff >= minRetentionMs) {
      return true;
    }
  }

  return false;
}

export function accumulateValue(
  acc: AggregateAccumulator,
  parsed: ParsedAggregate,
  left: unknown,
  right: unknown
): void {
  const { func, arg } = parsed;

  switch (func) {
    case 'COUNT': {
      if (arg === '*') {
        acc.count++;
      } else {
        const value = extractPathWithSide(arg, left, right);
        if (value !== undefined && value !== null) {
          acc.count++;
        }
      }
      break;
    }

    case 'SUM':
    case 'AVG':
    case 'MIN':
    case 'MAX': {
      const values = extractPathValuesWithSide(arg, left, right);
      for (const value of values) {
        if (typeof value === 'number' && !isNaN(value)) {
          acc.count++;
          acc.sum += value;
          acc.min = Math.min(acc.min, value);
          acc.max = Math.max(acc.max, value);
        }
      }
      break;
    }

    case 'COUNT_IF': {
      const values = extractPathValuesWithSide(arg, left, right);
      for (const value of values) {
        if (value === true || (typeof value === 'number' && value > 0)) {
          acc.conditionCount++;
        }
      }
      acc.count++;
      break;
    }

    case 'D1_RETENTION': {
      const values = extractPathValuesWithSide(arg, left, right);
      for (const value of values) {
        if (Array.isArray(value) && calculateRetention(value, 1)) {
          acc.conditionCount++;
        }
      }
      acc.count++;
      break;
    }

    case 'D7_RETENTION': {
      const values = extractPathValuesWithSide(arg, left, right);
      for (const value of values) {
        if (Array.isArray(value) && calculateRetention(value, 7)) {
          acc.conditionCount++;
        }
      }
      acc.count++;
      break;
    }
  }
}

export function finalizeAggregate(
  acc: AggregateAccumulator,
  parsed: ParsedAggregate
): number {
  const { func } = parsed;

  switch (func) {
    case 'COUNT':
      return acc.count;

    case 'SUM':
      return acc.sum;

    case 'AVG':
      return acc.count > 0 ? acc.sum / acc.count : 0;

    case 'MIN':
      return acc.count > 0 ? acc.min : 0;

    case 'MAX':
      return acc.count > 0 ? acc.max : 0;

    case 'COUNT_IF':
    case 'D1_RETENTION':
    case 'D7_RETENTION':
      return acc.conditionCount;

    default:
      return 0;
  }
}

export interface GroupAccumulators {
  [groupKey: string]: {
    [alias: string]: AggregateAccumulator;
  };
}

export function initializeGroupAccumulators(
  groups: GroupAccumulators,
  groupKey: string,
  aggregates: ParsedAggregate[]
): void {
  if (!groups[groupKey]) {
    groups[groupKey] = {};
    for (const agg of aggregates) {
      groups[groupKey][agg.alias] = createAccumulator();
    }
  }
}

export function accumulateGroup(
  groups: GroupAccumulators,
  groupKey: string,
  aggregates: ParsedAggregate[],
  left: unknown,
  right: unknown
): void {
  initializeGroupAccumulators(groups, groupKey, aggregates);

  for (const agg of aggregates) {
    accumulateValue(groups[groupKey][agg.alias], agg, left, right);
  }
}

export function finalizeGroups(
  groups: GroupAccumulators,
  aggregates: ParsedAggregate[]
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};

  for (const [groupKey, accumulators] of Object.entries(groups)) {
    result[groupKey] = {};
    for (const agg of aggregates) {
      result[groupKey][agg.alias] = finalizeAggregate(accumulators[agg.alias], agg);
    }
  }

  return result;
}

export function calculateTotals(
  groups: Record<string, Record<string, number>>,
  aggregates: ParsedAggregate[]
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const agg of aggregates) {
    const { alias, func } = agg;
    let total = 0;
    let count = 0;

    for (const groupValues of Object.values(groups)) {
      const value = groupValues[alias];
      if (func === 'AVG') {
        total += value;
        count++;
      } else if (func === 'MIN') {
        total = count === 0 ? value : Math.min(total, value);
        count++;
      } else if (func === 'MAX') {
        total = count === 0 ? value : Math.max(total, value);
        count++;
      } else {
        total += value;
      }
    }

    if (func === 'AVG' && count > 0) {
      totals[alias] = total / count;
    } else {
      totals[alias] = total;
    }
  }

  return totals;
}
