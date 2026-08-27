import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletMode, type AppContext } from '../../types.js';
import { registerAuthenticateTool } from '../authenticate.js';
import type { ToolRegistrar } from '../types.js';

describe('cpu_authenticate', () => {
    let client: Client | null = null;

    afterEach(async () => {
        await client?.close();
        client = null;
    });

    it('restores the game JWT through retained EVM wallet authority after it was cleared', async () => {
        let jwt: string | null = null;
        const getAccessToken = vi.fn(async () => {
            jwt = 'restored-jwt';
            return jwt;
        });
        const server = new McpServer({ name: 'authenticate-test', version: '0.0.0' });
        registerAuthenticateTool(server, {
            config: { WALLET_MODE: WalletMode.EVM, OPERATOR_PERSONA: false },
            wallet: { get: () => ({ getAddress: () => '0x1234' }) },
            auth: {
                getAccessToken,
                reauthenticate: vi.fn(),
            },
        } as unknown as AppContext);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'authenticate-client', version: '0.0.0' });
        await client.connect(clientTransport);

        const result = (await client.callTool({ name: 'cpu_authenticate', arguments: {} })) as CallToolResult;

        expect(result.isError).toBeUndefined();
        expect(result.content).toEqual([{ type: 'text', text: 'Authenticated as 0x1234. Session token stored.' }]);
        expect(getAccessToken).toHaveBeenCalledOnce();
        expect(jwt).toBe('restored-jwt');
    });

    it('restores the game JWT through retained AGW authority after it was cleared', async () => {
        const getAccessToken = vi.fn(async () => 'restored-jwt');
        const authenticateDevice = vi.fn();
        const handler = captureAuthenticateHandler({
            config: { WALLET_MODE: WalletMode.AGW, OPERATOR_PERSONA: false },
            session: {
                isAuthenticated: () => true,
                getSession: () => ({ jwt: null }),
            },
            auth: {
                getAccessToken,
                reauthenticate: vi.fn(),
                getPendingAuth: vi.fn(() => null),
                authenticateDevice,
            },
        } as unknown as AppContext);

        const result = await handler({ force: null });

        expect(result.isError).toBeUndefined();
        expect(result.content).toEqual([
            {
                type: 'text',
                text: 'Authenticated. Session token restored from the retained wallet session.',
            },
        ]);
        expect(getAccessToken).toHaveBeenCalledOnce();
        expect(authenticateDevice).not.toHaveBeenCalled();
    });
});

function captureAuthenticateHandler(context: AppContext): (args: { force: boolean | null }) => Promise<CallToolResult> {
    let handler: ((args: { force: boolean | null }) => Promise<CallToolResult>) | null = null;
    const registrar = {
        registerTool(
            _name: string,
            _definition: unknown,
            registeredHandler: (args: { force: boolean | null }) => Promise<CallToolResult>,
        ): void {
            handler = registeredHandler;
        },
    } as unknown as ToolRegistrar;

    registerAuthenticateTool(registrar, context);

    if (!handler) {
        throw new Error('cpu_authenticate was not registered');
    }

    return handler;
}
