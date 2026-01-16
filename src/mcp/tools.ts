import type { Tool, CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { KnowledgeBase } from '../knowledge-base/index.js';
import {
  search,
  getDependencies,
  find,
  exportSymbols,
  generateContext,
  type SearchableKind,
  type DependencyDirection,
} from '../query/index.js';

export const tools: Tool[] = [
  {
    name: 'list_projects',
    description: 'List all available knowledge base projects',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_symbols',
    description: 'Search for symbols by name across the knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        query: { type: 'string', description: 'Search term' },
        kind: {
          type: 'string',
          enum: ['class', 'interface', 'struct', 'enum', 'method', 'property', 'field'],
          description: 'Symbol kind filter',
        },
        namespace: { type: 'string', description: 'Namespace prefix filter' },
        pathFilter: { type: 'string', description: 'File path prefix filter (e.g., "Assets/Scripts/")' },
        limit: { type: 'number', description: 'Maximum results (default: 20)' },
      },
      required: ['project', 'query'],
    },
  },
  {
    name: 'get_symbol',
    description: 'Get detailed information about a specific symbol',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        name: { type: 'string', description: 'Symbol name' },
        namespace: { type: 'string', description: 'Namespace (optional, for disambiguation)' },
      },
      required: ['project', 'name'],
    },
  },
  {
    name: 'get_dependencies',
    description: 'Get incoming and outgoing dependencies for a symbol',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        symbol: { type: 'string', description: 'Symbol name' },
        direction: {
          type: 'string',
          enum: ['in', 'out', 'both'],
          description: 'Dependency direction (default: both)',
        },
        depth: { type: 'number', description: 'Transitive dependency depth (default: 1)' },
      },
      required: ['project', 'symbol'],
    },
  },
  {
    name: 'find_symbols',
    description: 'Find symbols matching specific criteria',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        kind: { type: 'string', enum: ['class', 'interface', 'struct', 'enum'], description: 'Symbol kind' },
        base: { type: 'string', description: 'Base class/interface name' },
        namespace: { type: 'string', description: 'Namespace prefix filter' },
        hasAttribute: { type: 'string', description: 'Has specific attribute' },
        hasMember: { type: 'string', description: 'Has member with name' },
        isUnityMessage: { type: 'boolean', description: 'Member is a Unity message' },
        limit: { type: 'number', description: 'Maximum results (default: 20)' },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_file_symbols',
    description: 'Get all symbols defined in a specific file',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        path: { type: 'string', description: 'Relative file path' },
      },
      required: ['project', 'path'],
    },
  },
  {
    name: 'find_relevant_files',
    description: 'Find files relevant to a task description',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        task: { type: 'string', description: 'Natural language task description' },
        maxFiles: { type: 'number', description: 'Maximum files to return (default: 10)' },
        excludePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Path prefixes to exclude (e.g., ["MetaplaySDK/", "Packages/"])',
        },
      },
      required: ['project', 'task'],
    },
  },
  {
    name: 'get_namespace_summary',
    description: 'Get summary of a namespace including all symbols',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        namespace: { type: 'string', description: 'Namespace name' },
      },
      required: ['project', 'namespace'],
    },
  },
  {
    name: 'list_namespaces',
    description: 'List all namespaces in the knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        prefix: { type: 'string', description: 'Filter by prefix' },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_implementations',
    description: 'Find all implementations of an interface',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Knowledge base name' },
        interface: { type: 'string', description: 'Interface name' },
      },
      required: ['project', 'interface'],
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

async function handleListProjects(dataDir: string): Promise<CallToolResult> {
  const projects = await KnowledgeBase.listProjects(dataDir);
  return successResult({ projects });
}

export async function handleTool(
  name: string,
  args: ToolArgs,
  getKnowledgeBase: (project: string) => Promise<KnowledgeBase | null>,
  dataDir: string
): Promise<CallToolResult> {
  if (name === 'list_projects') {
    return handleListProjects(dataDir);
  }

  const project = args.project as string | undefined;
  if (!project) {
    return errorResult('Missing required parameter: project');
  }

  const kb = await getKnowledgeBase(project);
  if (!kb) {
    return errorResult(`Knowledge base "${project}" not found`);
  }

  switch (name) {
    case 'search_symbols':
      return handleSearchSymbols(kb, args);
    case 'get_symbol':
      return handleGetSymbol(kb, args);
    case 'get_dependencies':
      return handleGetDependencies(kb, args);
    case 'find_symbols':
      return handleFindSymbols(kb, args);
    case 'get_file_symbols':
      return handleGetFileSymbols(kb, args);
    case 'find_relevant_files':
      return handleFindRelevantFiles(kb, args);
    case 'get_namespace_summary':
      return handleGetNamespaceSummary(kb, args);
    case 'list_namespaces':
      return handleListNamespaces(kb, args);
    case 'get_implementations':
      return handleGetImplementations(kb, args);
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function handleSearchSymbols(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const query = args.query as string | undefined;
  if (!query) {
    return errorResult('Missing required parameter: query');
  }

  const result = await search(kb, query, {
    kind: args.kind as SearchableKind | undefined,
    namespace: args.namespace as string | undefined,
    pathFilter: args.pathFilter as string | undefined,
    limit: (args.limit as number) ?? 20,
  });

  return successResult(result);
}

async function handleGetSymbol(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const name = args.name as string | undefined;
  if (!name) {
    return errorResult('Missing required parameter: name');
  }

  const targetNamespace = args.namespace as string | undefined;
  const symbols = await exportSymbols(kb, { namespace: targetNamespace });
  const symbol = symbols.find((s) => s.name === name);

  if (!symbol) {
    return errorResult(`Symbol "${name}" not found`);
  }

  return successResult(symbol);
}

async function handleGetDependencies(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const symbol = args.symbol as string | undefined;
  if (!symbol) {
    return errorResult('Missing required parameter: symbol');
  }

  const deps = await getDependencies(kb, symbol, {
    direction: (args.direction as DependencyDirection) ?? 'both',
    depth: (args.depth as number) ?? 1,
  });

  if (!deps) {
    return errorResult(`Symbol "${symbol}" not found`);
  }

  return successResult(deps);
}

async function handleFindSymbols(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const result = await find(kb, {
    kind: args.kind as SearchableKind | undefined,
    base: args.base as string | undefined,
    namespace: args.namespace as string | undefined,
    hasAttribute: args.hasAttribute as string | undefined,
    hasMember: args.hasMember as string | undefined,
    isUnityMessage: args.isUnityMessage as boolean | undefined,
    limit: (args.limit as number) ?? 20,
  });

  return successResult(result);
}

async function handleGetFileSymbols(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const path = args.path as string | undefined;
  if (!path) {
    return errorResult('Missing required parameter: path');
  }

  const symbols = await exportSymbols(kb, { file: path });

  if (symbols.length === 0) {
    return errorResult(`No symbols found in file "${path}"`);
  }

  return successResult({
    file: path,
    symbols,
  });
}

async function handleFindRelevantFiles(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const task = args.task as string | undefined;
  if (!task) {
    return errorResult('Missing required parameter: task');
  }

  const context = await generateContext(kb, task, {
    maxFiles: (args.maxFiles as number) ?? 10,
    excludePaths: args.excludePaths as string[] | undefined,
  });

  return successResult({
    task: context.task,
    files: context.files,
    startingPoints: context.startingPoints,
  });
}

async function handleGetNamespaceSummary(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const namespace = args.namespace as string | undefined;
  if (!namespace) {
    return errorResult('Missing required parameter: namespace');
  }

  const nsSymbols = await kb.readNamespaceSymbols(namespace);
  if (!nsSymbols) {
    return errorResult(`Namespace "${namespace}" not found`);
  }

  return successResult(nsSymbols);
}

async function handleListNamespaces(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const prefix = args.prefix as string | undefined;
  let namespaces = await kb.listNamespaces();

  if (prefix) {
    namespaces = namespaces.filter((ns) => ns.startsWith(prefix));
  }

  return successResult({ namespaces });
}

async function handleGetImplementations(kb: KnowledgeBase, args: ToolArgs): Promise<CallToolResult> {
  const interfaceName = args.interface as string | undefined;
  if (!interfaceName) {
    return errorResult('Missing required parameter: interface');
  }

  const result = await find(kb, { base: interfaceName });

  return successResult({
    interface: interfaceName,
    implementations: result.results.map((r) => ({
      symbol: r.symbol,
      namespace: r.namespace,
      file: r.file,
      line: r.line,
    })),
    total: result.total,
  });
}
