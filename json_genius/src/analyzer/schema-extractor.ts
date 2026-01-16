import { createJsonTokenStream, type TokenEvent } from '../streaming/json-stream.js';

export interface SchemaNode {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  $type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  arrayLength?: { min: number; max: number };
  pattern?: string;
  examples?: string[];
  optional?: boolean;
}

export interface SchemaExtractionOptions {
  maxDepth?: number;
  maxSamples?: number;
  detectPatterns?: boolean;
}

interface StackFrame {
  type: 'object' | 'array';
  key?: string;
  schema: SchemaNode;
  depth: number;
  arrayIndex: number;
}

const ENTITY_ID_PATTERN = /^[A-Za-z]+:[A-Za-z0-9]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;
const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function detectPattern(value: string): string | undefined {
  if (ENTITY_ID_PATTERN.test(value)) {
    const prefix = value.split(':')[0];
    return `${prefix}:xxx`;
  }
  if (DATE_PATTERN.test(value)) {
    return 'ISO date';
  }
  if (GUID_PATTERN.test(value)) {
    return 'GUID';
  }
  return undefined;
}

function mergeSchemas(existing: SchemaNode, incoming: SchemaNode): SchemaNode {
  if (existing.type !== incoming.type) {
    return existing;
  }

  const merged = { ...existing };

  if (incoming.$type && !existing.$type) {
    merged.$type = incoming.$type;
  }

  if (existing.type === 'object' && incoming.type === 'object') {
    merged.properties = { ...existing.properties };
    if (incoming.properties) {
      for (const [key, value] of Object.entries(incoming.properties)) {
        if (merged.properties![key]) {
          merged.properties![key] = mergeSchemas(merged.properties![key], value);
        } else {
          merged.properties![key] = { ...value, optional: true };
        }
      }
    }
  }

  if (existing.type === 'array' && incoming.type === 'array') {
    if (incoming.items && existing.items) {
      merged.items = mergeSchemas(existing.items, incoming.items);
    } else if (incoming.items) {
      merged.items = incoming.items;
    }

    if (incoming.arrayLength && existing.arrayLength) {
      merged.arrayLength = {
        min: Math.min(existing.arrayLength.min, incoming.arrayLength.min),
        max: Math.max(existing.arrayLength.max, incoming.arrayLength.max),
      };
    } else if (incoming.arrayLength) {
      merged.arrayLength = incoming.arrayLength;
    }
  }

  if (existing.type === 'string' && incoming.type === 'string') {
    if (incoming.pattern && !existing.pattern) {
      merged.pattern = incoming.pattern;
    }
    if (incoming.examples) {
      merged.examples = merged.examples || [];
      for (const ex of incoming.examples) {
        if (!merged.examples.includes(ex) && merged.examples.length < 3) {
          merged.examples.push(ex);
        }
      }
    }
  }

  return merged;
}

/**
 * Extracts a compact schema from a large JSON file using streaming.
 * Does not load the entire file into memory.
 */
export async function extractSchema(
  filePath: string,
  options: SchemaExtractionOptions = {}
): Promise<SchemaNode> {
  const {
    maxDepth = 10,
    maxSamples = 5,
    detectPatterns = true,
  } = options;

  const tokenStream = createJsonTokenStream(filePath);
  const stack: StackFrame[] = [];
  let rootSchema: SchemaNode | null = null;
  let currentKey: string | undefined;
  let samplesPerPath = new Map<string, number>();

  function getCurrentPath(): string {
    return stack.map((f) => f.key ?? `[${f.arrayIndex}]`).join('.');
  }

  function shouldSample(): boolean {
    const path = getCurrentPath();
    const count = samplesPerPath.get(path) ?? 0;
    if (count >= maxSamples) {
      return false;
    }
    samplesPerPath.set(path, count + 1);
    return true;
  }

  function getCurrentDepth(): number {
    return stack.length;
  }

  function createValueSchema(tokenName: string, value: unknown): SchemaNode {
    switch (tokenName) {
      case 'stringValue': {
        const strValue = value as string;
        const schema: SchemaNode = { type: 'string' };
        if (detectPatterns) {
          const pattern = detectPattern(strValue);
          if (pattern) {
            schema.pattern = pattern;
          } else if (strValue.length <= 50) {
            schema.examples = [strValue];
          }
        }
        return schema;
      }
      case 'numberValue':
        return { type: 'number' };
      case 'trueValue':
      case 'falseValue':
        return { type: 'boolean' };
      case 'nullValue':
        return { type: 'null' };
      default:
        return { type: 'string' };
    }
  }

  for await (const token of tokenStream) {
    const { name, value } = token;

    switch (name) {
      case 'startObject': {
        const schema: SchemaNode = { type: 'object', properties: {} };

        if (stack.length === 0) {
          rootSchema = schema;
          stack.push({ type: 'object', schema, depth: 0, arrayIndex: 0 });
        } else if (getCurrentDepth() < maxDepth && shouldSample()) {
          const frame = stack[stack.length - 1];
          if (frame.type === 'object' && currentKey) {
            frame.schema.properties![currentKey] = schema;
            stack.push({ type: 'object', key: currentKey, schema, depth: getCurrentDepth(), arrayIndex: 0 });
            currentKey = undefined;
          } else if (frame.type === 'array') {
            if (!frame.schema.items) {
              frame.schema.items = schema;
            } else {
              frame.schema.items = mergeSchemas(frame.schema.items, schema);
            }
            stack.push({ type: 'object', schema, depth: getCurrentDepth(), arrayIndex: frame.arrayIndex });
            frame.arrayIndex++;
          }
        } else {
          stack.push({ type: 'object', schema: { type: 'object' }, depth: getCurrentDepth(), arrayIndex: 0 });
        }
        break;
      }

      case 'endObject': {
        stack.pop();
        break;
      }

      case 'startArray': {
        const schema: SchemaNode = { type: 'array', arrayLength: { min: 0, max: 0 } };

        if (stack.length === 0) {
          rootSchema = schema;
          stack.push({ type: 'array', schema, depth: 0, arrayIndex: 0 });
        } else if (getCurrentDepth() < maxDepth) {
          const frame = stack[stack.length - 1];
          if (frame.type === 'object' && currentKey) {
            frame.schema.properties![currentKey] = schema;
            stack.push({ type: 'array', key: currentKey, schema, depth: getCurrentDepth(), arrayIndex: 0 });
            currentKey = undefined;
          } else if (frame.type === 'array') {
            if (!frame.schema.items) {
              frame.schema.items = schema;
            }
            stack.push({ type: 'array', schema, depth: getCurrentDepth(), arrayIndex: frame.arrayIndex });
            frame.arrayIndex++;
          }
        } else {
          stack.push({ type: 'array', schema: { type: 'array' }, depth: getCurrentDepth(), arrayIndex: 0 });
        }
        break;
      }

      case 'endArray': {
        const frame = stack.pop();
        if (frame && frame.schema.arrayLength) {
          frame.schema.arrayLength.max = frame.arrayIndex;
          frame.schema.arrayLength.min = Math.min(
            frame.schema.arrayLength.min || frame.arrayIndex,
            frame.arrayIndex
          );

          const parentFrame = stack[stack.length - 1];
          if (parentFrame && parentFrame.type === 'array' && parentFrame.schema.items?.type === 'array') {
            const parentItems = parentFrame.schema.items;
            if (parentItems.arrayLength) {
              parentItems.arrayLength.min = Math.min(parentItems.arrayLength.min, frame.schema.arrayLength.min);
              parentItems.arrayLength.max = Math.max(parentItems.arrayLength.max, frame.schema.arrayLength.max);
            }
          }
        }
        break;
      }

      case 'keyValue': {
        currentKey = value as string;
        break;
      }

      case 'stringValue':
      case 'numberValue':
      case 'trueValue':
      case 'falseValue':
      case 'nullValue': {
        if (stack.length === 0) {
          rootSchema = createValueSchema(name, value);
          break;
        }

        const frame = stack[stack.length - 1];

        if (frame.type === 'object' && currentKey) {
          if (getCurrentDepth() <= maxDepth) {
            if (currentKey === '$type' && typeof value === 'string') {
              frame.schema.$type = value;
            } else {
              const valueSchema = createValueSchema(name, value);

              if (!frame.schema.properties![currentKey]) {
                frame.schema.properties![currentKey] = valueSchema;
              } else {
                frame.schema.properties![currentKey] = mergeSchemas(
                  frame.schema.properties![currentKey],
                  valueSchema
                );
              }
            }
          }
          currentKey = undefined;
        } else if (frame.type === 'array') {
          frame.arrayIndex++;
          if (getCurrentDepth() <= maxDepth && shouldSample()) {
            const valueSchema = createValueSchema(name, value);
            if (!frame.schema.items) {
              frame.schema.items = valueSchema;
            } else {
              frame.schema.items = mergeSchemas(frame.schema.items, valueSchema);
            }
          }
        }
        break;
      }
    }
  }

  return rootSchema || { type: 'null' };
}

/**
 * Formats a schema as a compact YAML-like string (more token-efficient than JSON).
 */
export function formatSchemaYaml(schema: SchemaNode, indent = 0): string {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [];

  if (schema.$type) {
    lines.push(`${prefix}$type: "${schema.$type}"`);
  }

  if (schema.type === 'object' && schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const optionalMark = value.optional ? '?' : '';

      if (value.type === 'object' || value.type === 'array') {
        lines.push(`${prefix}${key}${optionalMark}:`);
        lines.push(formatSchemaYaml(value, indent + 1));
      } else {
        const typeStr = formatSimpleType(value);
        lines.push(`${prefix}${key}${optionalMark}: ${typeStr}`);
      }
    }
  } else if (schema.type === 'array') {
    const lengthStr = schema.arrayLength
      ? `[${schema.arrayLength.min}-${schema.arrayLength.max}]`
      : '[]';

    if (schema.items) {
      if (schema.items.type === 'object' || schema.items.type === 'array') {
        lines.push(`${prefix}array${lengthStr}:`);
        lines.push(formatSchemaYaml(schema.items, indent + 1));
      } else {
        const itemType = formatSimpleType(schema.items);
        lines.push(`${prefix}array${lengthStr} of ${itemType}`);
      }
    } else {
      lines.push(`${prefix}array${lengthStr}`);
    }
  } else {
    lines.push(`${prefix}${formatSimpleType(schema)}`);
  }

  return lines.join('\n');
}

function formatSimpleType(schema: SchemaNode): string {
  let result: string = schema.type;

  if (schema.$type) {
    result = `"${schema.$type}"`;
  } else if (schema.pattern) {
    result = `string (${schema.pattern})`;
  } else if (schema.examples && schema.examples.length > 0) {
    const exampleStr = schema.examples.slice(0, 2).map(e => `"${e}"`).join(', ');
    result = `string (e.g. ${exampleStr})`;
  }

  return result;
}

/**
 * Formats a schema as JSON (for programmatic consumption).
 */
export function formatSchemaJson(schema: SchemaNode): string {
  return JSON.stringify(schema, null, 2);
}
