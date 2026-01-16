import { resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { extractSchema, type SchemaNode } from './schema-extractor.js';
import { findRelationships, type DetectedRelationship } from './relationship-finder.js';
import { count } from '../query/aggregate.js';
import { logger } from '../utils/logger.js';

export interface FileInfo {
  name: string;
  sizeMB: number;
  entityCount: number;
  entityType?: string;
  keyFields: string[];
  sampleValues: Record<string, string[]>;
  metricsAvailable?: string[];
}

export interface RelationshipSummary {
  description: string;
  leftFile: string;
  leftKey: string;
  rightFile: string;
  rightKey: string;
  coverage: string;
  type: string;
}

export interface DatasetDescription {
  directory: string;
  files: FileInfo[];
  relationships: RelationshipSummary[];
  suggestedQueries: string[];
}

interface JsonFileEntry {
  name: string;
  path: string;
  sizeMB: number;
}

const ID_FIELD_PATTERN = /Id$|Ids$|^id$|^entityId$/i;
const METRICS_PATTERNS = ['History', 'Stats', 'createdAt', 'updatedAt', 'timestamp', 'count', 'total'];

async function findJsonFiles(directory: string): Promise<JsonFileEntry[]> {
  const absoluteDir = resolve(directory);
  const entries = await readdir(absoluteDir);
  const files: JsonFileEntry[] = [];

  for (const entry of entries) {
    if (entry.endsWith('.json')) {
      const filePath = resolve(absoluteDir, entry);
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        files.push({
          name: entry,
          path: filePath,
          sizeMB: fileStat.size / (1024 * 1024),
        });
      }
    }
  }

  return files;
}

function extractEntityType(schema: SchemaNode): string | undefined {
  if (schema.$type) {
    const parts = schema.$type.split('.');
    return parts[parts.length - 1];
  }

  if (schema.type === 'array' && schema.items?.$type) {
    const parts = schema.items.$type.split('.');
    return parts[parts.length - 1];
  }

  if (schema.type === 'object' && schema.properties?.entities?.type === 'array') {
    const entityItems = schema.properties.entities.items;
    if (entityItems?.$type) {
      const parts = entityItems.$type.split('.');
      return parts[parts.length - 1];
    }
  }

  return undefined;
}

function extractKeyFields(schema: SchemaNode, prefix = ''): string[] {
  const keyFields: string[] = [];

  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      if (ID_FIELD_PATTERN.test(key)) {
        keyFields.push(fullPath);
      }

      if (value.type === 'object') {
        keyFields.push(...extractKeyFields(value, fullPath));
      }
    }
  }

  if (schema.type === 'array' && schema.items?.type === 'object') {
    const itemsSchema = schema.items as SchemaNode;
    if (itemsSchema.properties) {
      for (const [key, value] of Object.entries(itemsSchema.properties)) {
        if (ID_FIELD_PATTERN.test(key)) {
          keyFields.push(key);
        }

        if (value.type === 'object') {
          keyFields.push(...extractKeyFields(value, key));
        }
      }
    }
  }

  return [...new Set(keyFields)];
}

function extractSampleValues(schema: SchemaNode, prefix = ''): Record<string, string[]> {
  const samples: Record<string, string[]> = {};

  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      if (value.type === 'string' && value.examples && value.examples.length > 0) {
        if (!value.pattern || value.pattern === 'ISO date' || value.pattern === 'GUID') {
          if (value.examples.length <= 5 && value.examples.every(e => e.length < 50)) {
            samples[fullPath] = value.examples;
          }
        }
      }

      if (value.type === 'object') {
        Object.assign(samples, extractSampleValues(value, fullPath));
      }
    }
  }

  if (schema.type === 'array' && schema.items?.type === 'object') {
    const itemsSchema = schema.items as SchemaNode;
    if (itemsSchema.properties) {
      for (const [key, value] of Object.entries(itemsSchema.properties)) {
        if (value.type === 'string' && value.examples && value.examples.length > 0) {
          if (!value.pattern || value.pattern === 'ISO date' || value.pattern === 'GUID') {
            if (value.examples.length <= 5 && value.examples.every(e => e.length < 50)) {
              samples[key] = value.examples;
            }
          }
        }

        if (value.type === 'object') {
          Object.assign(samples, extractSampleValues(value, key));
        }
      }
    }
  }

  return samples;
}

function extractMetricsFields(schema: SchemaNode, prefix = ''): string[] {
  const metrics: string[] = [];

  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      if (METRICS_PATTERNS.some(p => key.includes(p))) {
        metrics.push(fullPath);
      }

      if (value.type === 'number') {
        metrics.push(fullPath);
      }

      if (value.type === 'object') {
        metrics.push(...extractMetricsFields(value, fullPath));
      }
    }
  }

  if (schema.type === 'array' && schema.items?.type === 'object') {
    const itemsSchema = schema.items as SchemaNode;
    if (itemsSchema.properties) {
      for (const [key, value] of Object.entries(itemsSchema.properties)) {
        if (METRICS_PATTERNS.some(p => key.includes(p))) {
          metrics.push(key);
        }

        if (value.type === 'number') {
          metrics.push(key);
        }

        if (value.type === 'object') {
          metrics.push(...extractMetricsFields(value, key));
        }
      }
    }
  }

  return [...new Set(metrics)].slice(0, 10);
}

function generateSuggestedQueries(
  files: FileInfo[],
  relationships: RelationshipSummary[]
): string[] {
  const suggestions: string[] = [];

  for (const file of files) {
    for (const [field, values] of Object.entries(file.sampleValues)) {
      if (values.length >= 2) {
        suggestions.push(`Group by ${field} to compare ${file.name.replace('.json', '')} segments`);
        break;
      }
    }

    if (file.metricsAvailable && file.metricsAvailable.length > 0) {
      const metricsField = file.metricsAvailable.find(m =>
        m.includes('History') || m.includes('Stats')
      );
      if (metricsField) {
        suggestions.push(`Use ${metricsField} for ${metricsField.includes('login') ? 'retention' : 'analytics'} analysis`);
      }
    }
  }

  for (const rel of relationships) {
    suggestions.push(`Join on ${rel.leftKey} <-> ${rel.rightKey} for cross-file queries`);
  }

  return [...new Set(suggestions)].slice(0, 5);
}

export async function describeDataset(
  directory: string
): Promise<DatasetDescription> {
  logger.debug(`Describing dataset in: ${directory}`);

  const jsonFiles = await findJsonFiles(directory);
  logger.debug(`Found ${jsonFiles.length} JSON files`);

  if (jsonFiles.length === 0) {
    return {
      directory,
      files: [],
      relationships: [],
      suggestedQueries: [],
    };
  }

  const files: FileInfo[] = [];

  for (const jsonFile of jsonFiles) {
    logger.debug(`Processing ${jsonFile.name}`);

    try {
      const schema = await extractSchema(jsonFile.path, {
        maxDepth: 5,
        maxSamples: 10,
        detectPatterns: true,
      });

      const countResult = await count(jsonFile.path, {});

      const entityType = extractEntityType(schema);
      const keyFields = extractKeyFields(schema);
      const sampleValues = extractSampleValues(schema);
      const metricsAvailable = extractMetricsFields(schema);

      files.push({
        name: jsonFile.name,
        sizeMB: parseFloat(jsonFile.sizeMB.toFixed(1)),
        entityCount: countResult.total,
        entityType,
        keyFields,
        sampleValues,
        metricsAvailable: metricsAvailable.length > 0 ? metricsAvailable : undefined,
      });
    } catch (err) {
      logger.warn(`Failed to process ${jsonFile.name}: ${err}`);
      files.push({
        name: jsonFile.name,
        sizeMB: parseFloat(jsonFile.sizeMB.toFixed(1)),
        entityCount: 0,
        keyFields: [],
        sampleValues: {},
      });
    }
  }

  const relationships: RelationshipSummary[] = [];

  if (jsonFiles.length >= 2) {
    for (let i = 0; i < jsonFiles.length; i++) {
      for (let j = i + 1; j < jsonFiles.length; j++) {
        logger.debug(`Finding relationships between ${jsonFiles[i].name} and ${jsonFiles[j].name}`);

        try {
          const result = await findRelationships(jsonFiles[i].path, jsonFiles[j].path, {
            minCoverage: 50,
          });

          for (const rel of result.relationships) {
            relationships.push({
              description: `${jsonFiles[i].name.replace('.json', '')}.${rel.leftPath} -> ${jsonFiles[j].name.replace('.json', '')}.${rel.rightPath}`,
              leftFile: jsonFiles[i].name,
              leftKey: rel.leftPath,
              rightFile: jsonFiles[j].name,
              rightKey: rel.rightPath,
              coverage: `${rel.coverage.toFixed(0)}%`,
              type: rel.relationshipType,
            });
          }
        } catch (err) {
          logger.warn(`Failed to find relationships: ${err}`);
        }
      }
    }
  }

  const suggestedQueries = generateSuggestedQueries(files, relationships);

  return {
    directory,
    files,
    relationships,
    suggestedQueries,
  };
}
