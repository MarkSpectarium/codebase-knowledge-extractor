import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CODE_KNOWLEDGE_PATH = path.resolve(__dirname, '../../..', 'code_knowledge');
const DEFAULT_DATA_DIR = path.resolve(DEFAULT_CODE_KNOWLEDGE_PATH, '..', 'data');

export interface TypeInfo {
  name: string;
  fullName: string;
  kind: string;
  namespace?: string;
  bases?: string[];
  attributes?: string[];
  members?: MemberInfo[];
  file?: string;
  line?: number;
}

export interface MemberInfo {
  name: string;
  kind: string;
  signature?: string;
  attributes?: string[];
  modifiers?: string[];
}

export interface TypeResolutionResult {
  type: TypeInfo | null;
  dependencies?: TypeInfo[];
  error?: string;
}

export interface TypeResolutionOptions {
  project: string;
  showDeps?: boolean;
}

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

async function getClient(): Promise<Client> {
  if (client) {
    return client;
  }

  const isWindows = process.platform === 'win32';
  const codeKnowledgePath = DEFAULT_CODE_KNOWLEDGE_PATH;
  const dataDir = DEFAULT_DATA_DIR;
  const command = isWindows ? 'cmd' : 'sh';
  const serveCommand = `cd "${codeKnowledgePath}" && npx codebase-knowledge-extractor serve --data-dir "${dataDir}"`;
  const args = isWindows ? ['/c', serveCommand] : ['-c', serveCommand];

  transport = new StdioClientTransport({
    command,
    args,
  });

  client = new Client(
    { name: 'json-genius', version: '0.1.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  logger.debug('Connected to codebase-kb MCP server');

  return client;
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    transport = null;
  }
}

function parseSymbolResponse(result: unknown): TypeInfo | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const response = result as Record<string, unknown>;

  if ('content' in response && Array.isArray(response.content)) {
    const textContent = response.content.find(
      (c: unknown) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text'
    ) as { text: string } | undefined;

    if (textContent?.text) {
      try {
        const parsed = JSON.parse(textContent.text);
        if (parsed.error) {
          return null;
        }
        return parseTypeInfo(parsed);
      } catch {
        return null;
      }
    }
  }

  return parseTypeInfo(response);
}

function parseTypeInfo(data: unknown): TypeInfo | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    return null;
  }

  const members: MemberInfo[] = [];
  if (Array.isArray(obj.members)) {
    for (const m of obj.members) {
      if (m && typeof m === 'object') {
        const member = m as Record<string, unknown>;
        members.push({
          name: String(member.name ?? ''),
          kind: String(member.kind ?? 'unknown'),
          signature: member.signature ? String(member.signature) : undefined,
          attributes: Array.isArray(member.attributes) ? member.attributes.map(String) : undefined,
          modifiers: Array.isArray(member.modifiers) ? member.modifiers.map(String) : undefined,
        });
      }
    }
  }

  return {
    name: obj.name,
    fullName: obj.fullName ? String(obj.fullName) : obj.namespace ? `${obj.namespace}.${obj.name}` : obj.name,
    kind: String(obj.kind ?? 'unknown'),
    namespace: obj.namespace ? String(obj.namespace) : undefined,
    bases: Array.isArray(obj.bases) ? obj.bases.map(String) : undefined,
    attributes: Array.isArray(obj.attributes) ? obj.attributes.map(String) : undefined,
    members: members.length > 0 ? members : undefined,
    file: obj.file ? String(obj.file) : undefined,
    line: typeof obj.line === 'number' ? obj.line : undefined,
  };
}

function parseDependenciesResponse(result: unknown): TypeInfo[] | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const response = result as Record<string, unknown>;

  if ('content' in response && Array.isArray(response.content)) {
    const textContent = response.content.find(
      (c: unknown) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text'
    ) as { text: string } | undefined;

    if (textContent?.text) {
      try {
        const parsed = JSON.parse(textContent.text);
        if (parsed.error) {
          return null;
        }
        return extractDependencyTypes(parsed);
      } catch {
        return null;
      }
    }
  }

  return extractDependencyTypes(response);
}

function extractDependencyTypes(data: unknown): TypeInfo[] | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;
  const types: TypeInfo[] = [];

  // get_dependencies returns { incoming: DependencyRef[], outgoing: DependencyRef[] }
  // where DependencyRef is { symbol: string, file: string, namespace?: string }
  const incoming = Array.isArray(obj.incoming) ? obj.incoming : [];
  const outgoing = Array.isArray(obj.outgoing) ? obj.outgoing : [];

  const allDeps = [...incoming, ...outgoing];
  const seen = new Set<string>();

  for (const dep of allDeps) {
    if (!dep || typeof dep !== 'object') continue;
    const ref = dep as Record<string, unknown>;
    const symbol = ref.symbol ? String(ref.symbol) : null;
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);

    const namespace = ref.namespace ? String(ref.namespace) : undefined;
    types.push({
      name: symbol,
      fullName: namespace ? `${namespace}.${symbol}` : symbol,
      kind: 'unknown',
      namespace,
      file: ref.file ? String(ref.file) : undefined,
    });
  }

  return types.length > 0 ? types : null;
}

export async function resolveType(
  typeName: string,
  options: TypeResolutionOptions
): Promise<TypeResolutionResult> {
  const { project, showDeps = false } = options;

  try {
    const mcpClient = await getClient();

    const parts = typeName.split('.');
    const shortName = parts[parts.length - 1];
    const namespace = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;

    logger.debug(`Looking up symbol: ${shortName}${namespace ? ` in namespace ${namespace}` : ''} in project: ${project}`);

    const getSymbolArgs: Record<string, string> = {
      project,
      name: shortName,
    };
    if (namespace) {
      getSymbolArgs.namespace = namespace;
    }

    const result = await mcpClient.callTool({
      name: 'get_symbol',
      arguments: getSymbolArgs,
    });

    const typeInfo = parseSymbolResponse(result);

    if (!typeInfo) {
      return {
        type: null,
        error: `Type '${typeName}' not found in project '${project}'`,
      };
    }

    let dependencies: TypeInfo[] | undefined;

    if (showDeps) {
      logger.debug(`Looking up dependencies for: ${shortName}`);

      try {
        const depsResult = await mcpClient.callTool({
          name: 'get_dependencies',
          arguments: {
            project,
            symbol: shortName,
          },
        });

        const depsData = parseDependenciesResponse(depsResult);
        if (depsData) {
          dependencies = depsData;
        }
      } catch (err) {
        logger.debug(`Failed to get dependencies: ${err}`);
      }
    }

    return {
      type: typeInfo,
      dependencies,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      type: null,
      error: `Failed to resolve type: ${errorMessage}`,
    };
  }
}

export function formatTypeResult(result: TypeResolutionResult): string {
  const lines: string[] = [];

  if (result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join('\n');
  }

  if (!result.type) {
    lines.push('Type not found.');
    return lines.join('\n');
  }

  const type = result.type;

  lines.push(`Type: ${type.fullName}`);
  lines.push(`Kind: ${type.kind}`);

  if (type.bases && type.bases.length > 0) {
    lines.push(`Base: ${type.bases.join(', ')}`);
  }

  if (type.attributes && type.attributes.length > 0) {
    lines.push(`Attributes: ${type.attributes.join(', ')}`);
  }

  if (type.file) {
    const location = type.line ? `${type.file}:${type.line}` : type.file;
    lines.push(`Location: ${location}`);
  }

  if (type.members && type.members.length > 0) {
    lines.push('');
    lines.push('Members:');

    const properties = type.members.filter(m => m.kind === 'property');
    const fields = type.members.filter(m => m.kind === 'field');
    const methods = type.members.filter(m => m.kind === 'method');

    if (properties.length > 0) {
      for (const member of properties) {
        const attrs = member.attributes?.length ? ` [${member.attributes.join(', ')}]` : '';
        const sig = member.signature || member.name;
        lines.push(`  - ${sig}${attrs}`);
      }
    }

    if (fields.length > 0) {
      for (const member of fields) {
        const attrs = member.attributes?.length ? ` [${member.attributes.join(', ')}]` : '';
        const sig = member.signature || member.name;
        lines.push(`  - ${sig}${attrs}`);
      }
    }

    if (methods.length > 0) {
      lines.push('');
      lines.push('Methods:');
      for (const member of methods) {
        const attrs = member.attributes?.length ? ` [${member.attributes.join(', ')}]` : '';
        const sig = member.signature || `${member.name}()`;
        lines.push(`  - ${sig}${attrs}`);
      }
    }
  }

  if (result.dependencies && result.dependencies.length > 0) {
    lines.push('');
    lines.push('Dependencies:');
    for (const dep of result.dependencies) {
      lines.push(`  - ${dep.fullName} (${dep.kind})`);
    }
  }

  return lines.join('\n');
}
