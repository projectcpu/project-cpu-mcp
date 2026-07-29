import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ToolRegistrar = Pick<McpServer, 'registerTool'>;

export type ToolHandler<TArgs extends Array<unknown> = Array<unknown>> = (
    ...args: TArgs
) => CallToolResult | Promise<CallToolResult>;
