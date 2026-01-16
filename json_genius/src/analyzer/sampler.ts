import { createJsonArrayStream, type StreamArrayItem } from '../streaming/json-stream.js';
import { logger } from '../utils/logger.js';

export interface SampleOptions {
  count?: number;
  path?: string;
  entityType?: string;
  seed?: number;
  truncateStrings?: number;
  maxDepth?: number;
}

export interface SampleResult<T = unknown> {
  items: T[];
  totalScanned: number;
  matchedCount: number;
}

/**
 * Extracts a path segment value from an object using dot notation.
 * Supports array wildcards [*] and specific indices [0].
 */
function getValueAtPath(obj: unknown, path: string): unknown[] {
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
 * Truncates strings and nested content for display.
 */
function truncateValue(value: unknown, maxStringLength: number, maxDepth: number, currentDepth = 0): unknown {
  if (currentDepth > maxDepth) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }
    if (typeof value === 'object' && value !== null) {
      return `{Object}`;
    }
    return value;
  }

  if (typeof value === 'string' && value.length > maxStringLength) {
    return value.slice(0, maxStringLength) + '...';
  }

  if (Array.isArray(value)) {
    return value.map(v => truncateValue(v, maxStringLength, maxDepth, currentDepth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = truncateValue(v, maxStringLength, maxDepth, currentDepth + 1);
    }
    return result;
  }

  return value;
}

/**
 * Simple seeded random number generator for reproducible sampling.
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Reservoir sampling algorithm for random selection from a stream.
 * Ensures uniform probability of selection for each item.
 */
function reservoirSample<T>(
  items: T[],
  newItem: T,
  maxSize: number,
  random: () => number,
  currentTotal: number
): T[] {
  if (items.length < maxSize) {
    items.push(newItem);
  } else {
    const replaceIndex = Math.floor(random() * currentTotal);
    if (replaceIndex < maxSize) {
      items[replaceIndex] = newItem;
    }
  }
  return items;
}

/**
 * Checks if an entity matches the specified entity type filter.
 */
function matchesEntityType(entity: unknown, entityType: string): boolean {
  if (typeof entity !== 'object' || entity === null) {
    return false;
  }

  const obj = entity as Record<string, unknown>;

  if (typeof obj.entityId === 'string') {
    return obj.entityId.startsWith(`${entityType}:`);
  }

  if (typeof obj.$type === 'string') {
    return obj.$type.includes(entityType);
  }

  return false;
}

/**
 * Smart sampler that extracts representative data samples from large JSON files.
 * Uses streaming to avoid loading the entire file into memory.
 */
export async function sampleData<T = unknown>(
  filePath: string,
  options: SampleOptions = {}
): Promise<SampleResult<T>> {
  const {
    count = 3,
    path,
    entityType,
    seed = Date.now(),
    truncateStrings = 200,
    maxDepth = 10,
  } = options;

  const random = seededRandom(seed);
  let samples: T[] = [];
  let totalScanned = 0;
  let matchedCount = 0;

  const pickPath = path?.startsWith('entities') ? 'entities' : undefined;
  const stream = createJsonArrayStream<unknown>(filePath, { pickPath });

  logger.debug(`Sampling from ${filePath} with options: count=${count}, path=${path || 'root'}, entityType=${entityType || 'any'}`);

  for await (const { value } of stream) {
    totalScanned++;

    let targetValue: unknown = value;

    if (path && !path.startsWith('entities')) {
      const values = getValueAtPath(value, path);
      if (values.length === 0) {
        continue;
      }
      targetValue = values.length === 1 ? values[0] : values;
    } else if (path?.startsWith('entities[*].')) {
      const subPath = path.replace('entities[*].', '');
      const values = getValueAtPath(value, subPath);
      if (values.length === 0) {
        continue;
      }
      targetValue = values.length === 1 ? values[0] : values;
    }

    if (entityType && !matchesEntityType(value, entityType)) {
      continue;
    }

    matchedCount++;

    const truncated = truncateValue(targetValue, truncateStrings, maxDepth) as T;
    samples = reservoirSample(samples, truncated, count, random, matchedCount);
  }

  logger.debug(`Sampling complete: scanned ${totalScanned}, matched ${matchedCount}, sampled ${samples.length}`);

  return {
    items: samples,
    totalScanned,
    matchedCount,
  };
}

/**
 * Formats sample results for display.
 */
export function formatSamples<T>(result: SampleResult<T>, format: 'json' | 'pretty' = 'pretty'): string {
  const header = `# Sampled ${result.items.length} of ${result.matchedCount} matched items (${result.totalScanned} total scanned)\n\n`;

  if (format === 'json') {
    return JSON.stringify(result.items, null, 2);
  }

  const formatted = result.items.map((item, index) => {
    return `## Sample ${index + 1}\n${JSON.stringify(item, null, 2)}`;
  }).join('\n\n');

  return header + formatted;
}
