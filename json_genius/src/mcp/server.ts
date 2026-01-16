import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { tools, handleTool } from './tools.js';

export interface McpServerOptions {
  dataDir?: string;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = new Server(
    {
      name: 'json-genius',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
