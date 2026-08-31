import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthenticationRequiredError } from '../authentication-required.error.js';

let client: Client | null = null;

afterEach(async () => {
    await client?.close();
    client = null;
});

describe('AuthenticationRequiredError', () => {
    it('exposes stable recovery fields through the public MCP tool boundary', async () => {
        const server = new McpServer({ name: 'authentication-required-test', version: '0.0.0' });
        server.registerTool('cpu_test_authentication_required', { inputSchema: {} }, () => {
            throw new AuthenticationRequiredError();
        });

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'authentication-required-client', version: '0.0.0' });
        await client.connect(clientTransport);

        const result = (await client.callTool({
            name: 'cpu_test_authentication_required',
            arguments: {},
        })) as CallToolResult;
        const text = result.content?.find((block) => block.type === 'text');

        expect(result.isError).toBe(true);
        expect(text).toEqual({
            type: 'text',
            text: JSON.stringify({
                code: 'AUTHENTICATION_REQUIRED',
                stateCleared: true,
                nextTool: 'cpu_authenticate',
            }),
        });
    });
});
