import type { Tool, CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { extractSchema, formatSchemaJson, formatSchemaYaml } from '../analyzer/schema-extractor.js';
import { sampleData } from '../analyzer/sampler.js';
import { executeQuery } from '../query/path-query.js';
import { count, groupBy, stats } from '../query/aggregate.js';
import { findRelationships } from '../analyzer/relationship-finder.js';
import { resolveType, closeClient } from '../type-resolver/mcp-bridge.js';
import { executeJoin } from '../query/join.js';
import { runReport, AVAILABLE_REPORTS, type ReportName } from '../analytics/reports.js';

export const tools: Tool[] = [
  {
    name: 'get_schema',
    description: 'Get compact schema for a JSON file',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to JSON file' },
        depth: { type: 'number', description: 'Max depth (default: 10)' },
        format: { type: 'string', enum: ['yaml', 'json'], description: 'Output format (default: yaml)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'sample_data',
    description: 'Get sample entities from a JSON file',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to JSON file' },
        count: { type: 'number', description: 'Number of samples (default: 3)' },
        path: { type: 'string', description: 'JSONPath-like path to sample from' },
        entityType: { type: 'string', description: 'Filter by entity type (e.g., "Player")' },
      },
      required: ['file'],
    },
  },
  {
    name: 'query_json',
    description: 'Run path-based queries on a JSON file',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to JSON file' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to select (e.g., ["entityId", "payload.name"])',
        },
        filter: { type: 'string', description: 'Filter expression (e.g., "payload.level > 10")' },
        limit: { type: 'number', description: 'Maximum results (default: 100)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'count_entities',
    description: 'Count entities with optional filter',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to JSON file' },
        filter: { type: 'string', description: 'Filter expression' },
      },
      required: ['file'],
    },
  },
  {
    name: 'group_by',
    description: 'Group and count by field',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to JSON file' },
        path: { type: 'string', description: 'Path to the field to group by' },
        filter: { type: 'string', description: 'Filter expression' },
      },
      required: ['file', 'path'],
    },
  },
  {
    name: 'get_stats',
    description: 'Numeric field statistics',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to JSON file' },
        path: { type: 'string', description: 'Path to the numeric field' },
        filter: { type: 'string', description: 'Filter expression' },
      },
      required: ['file', 'path'],
    },
  },
  {
    name: 'find_relationships',
    description: 'Discover cross-file links between two JSON files',
    inputSchema: {
      type: 'object',
      properties: {
        file1: { type: 'string', description: 'Path to first JSON file' },
        file2: { type: 'string', description: 'Path to second JSON file' },
      },
      required: ['file1', 'file2'],
    },
  },
  {
    name: 'resolve_type',
    description: 'Look up $type in codebase knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        typeName: { type: 'string', description: 'Full type name (e.g., "Myths.SharedCode.PlayerModel")' },
        project: { type: 'string', description: 'Knowledge base project name' },
      },
      required: ['typeName', 'project'],
    },
  },
  {
    name: 'join_files',
    description: 'Cross-file query using relationships',
    inputSchema: {
      type: 'object',
      properties: {
        file1: { type: 'string', description: 'Path to left JSON file' },
        file2: { type: 'string', description: 'Path to right JSON file' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to select (prefix with a. or b.)',
        },
        filter: { type: 'string', description: 'Filter expression (prefix paths with a. or b.)' },
        leftKey: { type: 'string', description: 'Path to join key in left file' },
        rightKey: { type: 'string', description: 'Path to join key in right file' },
      },
      required: ['file1', 'file2'],
    },
  },
  {
    name: 'run_report',
    description: 'Run pre-built analytics report',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory containing JSON files' },
        report: {
          type: 'string',
          enum: ['player-kpis', 'retention', 'progression', 'schema-summary'],
          description: 'Report name',
        },
      },
      required: ['directory', 'report'],
    },
  },
];

export interface ToolArgs {
  [key: string]: unknown;
}

function errorResult(message: string): CallToolResult {
  const textContent: TextContent = { type: 'text', text: JSON.stringify({ error: message }) };
  return {
    content: [textContent],
    isError: true,
  };
}

function successResult(data: unknown): CallToolResult {
  const textContent: TextContent = { type: 'text', text: JSON.stringify(data, null, 2) };
  return {
    content: [textContent],
  };
}

async function validateFile(file: string): Promise<string | null> {
  try {
    const filePath = resolve(file);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return null;
    }
    return filePath;
  } catch {
    return null;
  }
}

export async function handleTool(
  name: string,
  args: ToolArgs
): Promise<CallToolResult> {
  try {
    switch (name) {
      case 'get_schema':
        return handleGetSchema(args);
      case 'sample_data':
        return handleSampleData(args);
      case 'query_json':
        return handleQueryJson(args);
      case 'count_entities':
        return handleCountEntities(args);
      case 'group_by':
        return handleGroupBy(args);
      case 'get_stats':
        return handleGetStats(args);
      case 'find_relationships':
        return handleFindRelationships(args);
      case 'resolve_type':
        return handleResolveType(args);
      case 'join_files':
        return handleJoinFiles(args);
      case 'run_report':
        return handleRunReport(args);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }
}

async function handleGetSchema(args: ToolArgs): Promise<CallToolResult> {
  const file = args.file as string | undefined;
  if (!file) {
    return errorResult('Missing required parameter: file');
  }

  const filePath = await validateFile(file);
  if (!filePath) {
    return errorResult(`File not found: ${file}`);
  }

  const depth = (args.depth as number) ?? 10;
  const format = (args.format as string) ?? 'yaml';

  const schema = await extractSchema(filePath, {
    maxDepth: depth,
    maxSamples: 5,
    detectPatterns: true,
  });

  const formatted = format === 'json' ? formatSchemaJson(schema) : formatSchemaYaml(schema);

  return successResult({
    file,
    schema: format === 'json' ? schema : undefined,
    formatted,
  });
}

async function handleSampleData(args: ToolArgs): Promise<CallToolResult> {
  const file = args.file as string | undefined;
  if (!file) {
    return errorResult('Missing required parameter: file');
  }

  const filePath = await validateFile(file);
  if (!filePath) {
    return errorResult(`File not found: ${file}`);
  }

  const sampleCount = (args.count as number) ?? 3;
  const path = args.path as string | undefined;
  const entityType = args.entityType as string | undefined;

  const result = await sampleData(filePath, {
    count: sampleCount,
    path,
    entityType,
  });

  return successResult({
    file,
    samples: result.items,
    totalScanned: result.totalScanned,
    matchedCount: result.matchedCount,
  });
}

async function handleQueryJson(args: ToolArgs): Promise<CallToolResult> {
  const file = args.file as string | undefined;
  if (!file) {
    return errorResult('Missing required parameter: file');
  }

  const filePath = await validateFile(file);
  if (!filePath) {
    return errorResult(`File not found: ${file}`);
  }

  const select = args.select as string[] | undefined;
  const filter = args.filter as string | undefined;
  const limit = (args.limit as number) ?? 100;

  const result = await executeQuery(filePath, {
    select,
    filter,
    limit,
  });

  return successResult({
    file,
    items: result.items,
    totalMatched: result.totalMatched,
    totalScanned: result.totalScanned,
  });
}

async function handleCountEntities(args: ToolArgs): Promise<CallToolResult> {
  const file = args.file as string | undefined;
  if (!file) {
    return errorResult('Missing required parameter: file');
  }

  const filePath = await validateFile(file);
  if (!filePath) {
    return errorResult(`File not found: ${file}`);
  }

  const filter = args.filter as string | undefined;

  const result = await count(filePath, { filter });

  return successResult({
    file,
    count: result.total,
    scanned: result.scanned,
  });
}

async function handleGroupBy(args: ToolArgs): Promise<CallToolResult> {
  const file = args.file as string | undefined;
  const path = args.path as string | undefined;

  if (!file) {
    return errorResult('Missing required parameter: file');
  }
  if (!path) {
    return errorResult('Missing required parameter: path');
  }

  const filePath = await validateFile(file);
  if (!filePath) {
    return errorResult(`File not found: ${file}`);
  }

  const filter = args.filter as string | undefined;

  const result = await groupBy(filePath, { path, filter });

  return successResult({
    file,
    groups: result.groups,
    total: result.total,
    uniqueValues: result.uniqueValues,
    scanned: result.scanned,
  });
}

async function handleGetStats(args: ToolArgs): Promise<CallToolResult> {
  const file = args.file as string | undefined;
  const path = args.path as string | undefined;

  if (!file) {
    return errorResult('Missing required parameter: file');
  }
  if (!path) {
    return errorResult('Missing required parameter: path');
  }

  const filePath = await validateFile(file);
  if (!filePath) {
    return errorResult(`File not found: ${file}`);
  }

  const filter = args.filter as string | undefined;

  const result = await stats(filePath, { path, filter });

  return successResult({
    file,
    count: result.count,
    sum: result.sum,
    avg: result.avg,
    min: result.min,
    max: result.max,
    scanned: result.scanned,
  });
}

async function handleFindRelationships(args: ToolArgs): Promise<CallToolResult> {
  const file1 = args.file1 as string | undefined;
  const file2 = args.file2 as string | undefined;

  if (!file1) {
    return errorResult('Missing required parameter: file1');
  }
  if (!file2) {
    return errorResult('Missing required parameter: file2');
  }

  const filePath1 = await validateFile(file1);
  const filePath2 = await validateFile(file2);

  if (!filePath1) {
    return errorResult(`File not found: ${file1}`);
  }
  if (!filePath2) {
    return errorResult(`File not found: ${file2}`);
  }

  const result = await findRelationships(filePath1, filePath2, { minCoverage: 50 });

  return successResult({
    leftFile: result.leftFile,
    rightFile: result.rightFile,
    relationships: result.relationships.map(r => ({
      leftPath: r.leftPath,
      rightPath: r.rightPath,
      relationshipType: r.relationshipType,
      coverage: r.coverage,
      matchedCount: r.matchedCount,
      totalCount: r.totalCount,
    })),
    scannedLeft: result.scannedLeft,
    scannedRight: result.scannedRight,
  });
}

async function handleResolveType(args: ToolArgs): Promise<CallToolResult> {
  const typeName = args.typeName as string | undefined;
  const project = args.project as string | undefined;

  if (!typeName) {
    return errorResult('Missing required parameter: typeName');
  }
  if (!project) {
    return errorResult('Missing required parameter: project');
  }

  try {
    const result = await resolveType(typeName, { project });

    if (result.error) {
      return errorResult(result.error);
    }

    return successResult({
      type: result.type,
      dependencies: result.dependencies,
    });
  } finally {
    await closeClient();
  }
}

async function handleJoinFiles(args: ToolArgs): Promise<CallToolResult> {
  const file1 = args.file1 as string | undefined;
  const file2 = args.file2 as string | undefined;

  if (!file1) {
    return errorResult('Missing required parameter: file1');
  }
  if (!file2) {
    return errorResult('Missing required parameter: file2');
  }

  const filePath1 = await validateFile(file1);
  const filePath2 = await validateFile(file2);

  if (!filePath1) {
    return errorResult(`File not found: ${file1}`);
  }
  if (!filePath2) {
    return errorResult(`File not found: ${file2}`);
  }

  const select = args.select as string[] | undefined;
  const filter = args.filter as string | undefined;
  const leftKey = args.leftKey as string | undefined;
  const rightKey = args.rightKey as string | undefined;

  const result = await executeJoin(filePath1, filePath2, {
    select,
    filter,
    leftKey,
    rightKey,
    limit: 100,
  });

  return successResult({
    items: result.items,
    totalMatched: result.totalMatched,
    leftScanned: result.leftScanned,
    rightScanned: result.rightScanned,
    joinKeys: result.joinKeys,
  });
}

async function handleRunReport(args: ToolArgs): Promise<CallToolResult> {
  const directory = args.directory as string | undefined;
  const report = args.report as string | undefined;

  if (!directory) {
    return errorResult('Missing required parameter: directory');
  }
  if (!report) {
    return errorResult('Missing required parameter: report');
  }

  if (!AVAILABLE_REPORTS.includes(report as ReportName)) {
    return errorResult(`Unknown report: ${report}. Available: ${AVAILABLE_REPORTS.join(', ')}`);
  }

  const result = await runReport(directory, report as ReportName, { format: 'json' });

  return successResult({
    report: result.report,
    data: result.data,
  });
}
