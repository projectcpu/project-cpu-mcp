import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { WalletMode, type AppContext } from '../../types.js';
import { registerAuthenticateTool } from '../authenticate.js';
import type { ToolRegistrar } from '../types.js';

describe('cpu_authenticate', () => {
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
