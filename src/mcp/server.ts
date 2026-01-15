import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { KnowledgeBase } from '../knowledge-base/index.js';
import { tools, handleTool } from './tools.js';

export interface McpServerOptions {
  dataDir: string;
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const { dataDir } = options;
  const absoluteDataDir = resolve(dataDir);

  const server = new Server(
    {
      name: 'codebase-kb',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  async function getKnowledgeBase(project: string): Promise<KnowledgeBase | null> {
    const kb = new KnowledgeBase(absoluteDataDir, project);
    if (await kb.exists()) {
      return kb;
    }
    return null;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, args ?? {}, getKnowledgeBase);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
