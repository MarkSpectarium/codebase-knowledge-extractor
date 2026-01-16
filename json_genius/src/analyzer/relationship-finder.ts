import { createJsonArrayStream } from '../streaming/json-stream.js';
import { logger } from '../utils/logger.js';

export interface IdField {
  path: string;
  values: Set<string>;
  valuePattern?: string;
}

export interface DetectedRelationship {
  leftPath: string;
  rightPath: string;
  relationshipType: string;
  matchedCount: number;
  totalCount: number;
  coverage: number;
}

export interface RelationshipResult {
  relationships: DetectedRelationship[];
  leftFile: string;
  rightFile: string;
  leftIdFields: IdField[];
  rightIdFields: IdField[];
  scannedLeft: number;
  scannedRight: number;
}

export interface RelationshipOptions {
  minCoverage?: number;
  verbose?: boolean;
}

const ID_FIELD_PATTERNS = [
  /Id$/,
  /Ids$/,
  /id$/,
  /ids$/,
  /entityId/i,
  /^id$/i,
];

const ENTITY_ID_VALUE_PATTERN = /^[A-Z][a-zA-Z]+:[0-9A-Fa-f]+$/;

function isIdFieldName(name: string): boolean {
  return ID_FIELD_PATTERNS.some(pattern => pattern.test(name));
}

function isEntityIdValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return ENTITY_ID_VALUE_PATTERN.test(value);
  }
  return false;
}

function extractIdValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('value' in obj && (typeof obj.value === 'string' || typeof obj.value === 'number')) {
      return String(obj.value);
    }
  }
  return null;
}

function collectIdFields(
  obj: unknown,
  currentPath: string,
  idFields: Map<string, Set<string>>,
  maxDepth: number = 20
): void {
  if (maxDepth <= 0) return;
  if (obj === null || obj === undefined) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectIdFields(item, `${currentPath}[*]`, idFields, maxDepth - 1);
    }
    return;
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;

      if (isIdFieldName(key)) {
        const idValue = extractIdValue(value);
        if (idValue) {
          if (!idFields.has(newPath)) {
            idFields.set(newPath, new Set());
          }
          idFields.get(newPath)!.add(idValue);
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            const itemValue = extractIdValue(item);
            if (itemValue) {
              if (!idFields.has(`${newPath}[*]`)) {
                idFields.set(`${newPath}[*]`, new Set());
              }
              idFields.get(`${newPath}[*]`)!.add(itemValue);
            }
          }
        }
      } else if (isEntityIdValue(value)) {
        if (!idFields.has(newPath)) {
          idFields.set(newPath, new Set());
        }
        idFields.get(newPath)!.add(value as string);
      }

      collectIdFields(value, newPath, idFields, maxDepth - 1);
    }
  }
}

async function scanFileForIds(
  filePath: string
): Promise<{ idFields: Map<string, Set<string>>; scanned: number }> {
  const stream = createJsonArrayStream<unknown>(filePath, { pickPath: 'entities' });
  const idFields = new Map<string, Set<string>>();
  let scanned = 0;

  for await (const { value } of stream) {
    scanned++;
    collectIdFields(value, '', idFields);
  }

  return { idFields, scanned };
}

function detectValuePattern(values: Set<string>): string | undefined {
  const sample = Array.from(values).slice(0, 10);

  if (sample.every(v => ENTITY_ID_VALUE_PATTERN.test(v))) {
    const types = new Set(sample.map(v => v.split(':')[0]));
    if (types.size === 1) {
      return `${Array.from(types)[0]}:*`;
    }
    return 'EntityId:*';
  }

  if (sample.every(v => /^[0-9A-Fa-f]{16,}$/.test(v))) {
    return 'hex-id';
  }

  if (sample.every(v => /^\d+$/.test(v))) {
    return 'numeric-id';
  }

  return undefined;
}

function inferRelationshipType(
  leftPath: string,
  rightPath: string,
  leftCount: number,
  rightCount: number
): string {
  const leftIsArray = leftPath.includes('[*]');
  const rightIsArray = rightPath.includes('[*]');

  if (leftIsArray && !rightIsArray) {
    return 'one-to-many';
  }
  if (!leftIsArray && rightIsArray) {
    return 'many-to-one';
  }
  if (leftIsArray && rightIsArray) {
    return 'many-to-many';
  }
  if (leftCount === rightCount) {
    return 'one-to-one';
  }
  return 'many-to-one';
}

export async function findRelationships(
  leftFile: string,
  rightFile: string,
  options: RelationshipOptions = {}
): Promise<RelationshipResult> {
  const { minCoverage = 50, verbose = false } = options;

  logger.debug(`Scanning left file: ${leftFile}`);
  const { idFields: leftIdFields, scanned: scannedLeft } = await scanFileForIds(leftFile);
  logger.debug(`Found ${leftIdFields.size} ID fields in left file`);

  logger.debug(`Scanning right file: ${rightFile}`);
  const { idFields: rightIdFields, scanned: scannedRight } = await scanFileForIds(rightFile);
  logger.debug(`Found ${rightIdFields.size} ID fields in right file`);

  const relationships: DetectedRelationship[] = [];

  for (const [leftPath, leftValues] of leftIdFields) {
    for (const [rightPath, rightValues] of rightIdFields) {
      let matchedCount = 0;
      for (const value of leftValues) {
        if (rightValues.has(value)) {
          matchedCount++;
        }
      }

      if (matchedCount === 0) continue;

      const coverage = (matchedCount / leftValues.size) * 100;

      if (coverage >= minCoverage) {
        const relationshipType = inferRelationshipType(
          leftPath,
          rightPath,
          leftValues.size,
          rightValues.size
        );

        relationships.push({
          leftPath,
          rightPath,
          relationshipType,
          matchedCount,
          totalCount: leftValues.size,
          coverage,
        });
      }
    }
  }

  relationships.sort((a, b) => b.coverage - a.coverage);

  const leftIdFieldsResult: IdField[] = Array.from(leftIdFields.entries()).map(([path, values]) => ({
    path,
    values,
    valuePattern: detectValuePattern(values),
  }));

  const rightIdFieldsResult: IdField[] = Array.from(rightIdFields.entries()).map(([path, values]) => ({
    path,
    values,
    valuePattern: detectValuePattern(values),
  }));

  return {
    relationships,
    leftFile,
    rightFile,
    leftIdFields: verbose ? leftIdFieldsResult : leftIdFieldsResult.filter(f =>
      relationships.some(r => r.leftPath === f.path)
    ),
    rightIdFields: verbose ? rightIdFieldsResult : rightIdFieldsResult.filter(f =>
      relationships.some(r => r.rightPath === f.path)
    ),
    scannedLeft,
    scannedRight,
  };
}

export function formatRelationshipResult(result: RelationshipResult, verbose: boolean = false): string {
  const lines: string[] = [];

  if (result.relationships.length === 0) {
    lines.push('No relationships detected with sufficient coverage.');
    if (!verbose) {
      lines.push('Try --verbose to see all detected ID fields.');
    }
  } else {
    lines.push('Detected relationships:');
    lines.push('');

    for (const rel of result.relationships) {
      lines.push(`- ${result.leftFile.split(/[\\/]/).pop()}: ${rel.leftPath}`);
      lines.push(`  -> ${result.rightFile.split(/[\\/]/).pop()}: ${rel.rightPath}`);
      lines.push(`  Type: ${rel.relationshipType}`);
      lines.push(`  Coverage: ${rel.coverage.toFixed(1)}% of IDs matched (${rel.matchedCount}/${rel.totalCount})`);
      lines.push('');
    }
  }

  if (verbose) {
    lines.push('');
    lines.push(`All ID fields in ${result.leftFile.split(/[\\/]/).pop()}:`);
    for (const field of result.leftIdFields) {
      const pattern = field.valuePattern ? ` [${field.valuePattern}]` : '';
      lines.push(`  - ${field.path} (${field.values.size} unique values)${pattern}`);
    }

    lines.push('');
    lines.push(`All ID fields in ${result.rightFile.split(/[\\/]/).pop()}:`);
    for (const field of result.rightIdFields) {
      const pattern = field.valuePattern ? ` [${field.valuePattern}]` : '';
      lines.push(`  - ${field.path} (${field.values.size} unique values)${pattern}`);
    }
  }

  lines.push('');
  lines.push(`Scanned: ${result.scannedLeft} entities (left), ${result.scannedRight} entities (right)`);

  return lines.join('\n');
}
