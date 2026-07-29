import { z } from 'zod';

import type { AppContext } from '../types.js';
import { WalletMode } from '../types.js';
import type { ToolRegistrar } from './types.js';

const DESCRIPTION = [
    'Create a blockchain session.',
    'Call this tool when other tools fail with authentication or session errors',
    '(e.g. "not authenticated", "session expired").',
    'In EVM mode this signs in via SIWE locally and stores the token.',
    'In AGW mode it returns a URL the user must open in their browser to approve.',
    'Once authenticated, subsequent wallet-dependent tools will work automatically.',
    'Pass force=true to discard the cached session and authenticate from scratch',
    '(e.g. after the game server was reset and the stored token references a stale user).',
].join(' ');

const inputSchema = {
    force: z
        .boolean()
        .nullable()
        .default(null)
        .describe('Ignore the stored session and re-run authentication from scratch.'),
};

export function registerAuthenticateTool(server: ToolRegistrar, context: AppContext): void {
    const authService = context.auth;

    server.registerTool('cpu_authenticate', { description: DESCRIPTION, inputSchema }, async (args) => {
        const force = args.force ?? false;

        // EVM mode: SIWE signs locally with the env private key — no browser step.
        // getAccessToken returns the cached token if still valid; force re-runs SIWE login regardless.
        if (context.config.WALLET_MODE === WalletMode.EVM) {
            await (force ? authService.reauthenticate() : authService.getAccessToken());
            const address = context.wallet.get().getAddress();
            const suffix = force ? ' (forced fresh SIWE login).' : '.';
            return {
                content: [{ type: 'text', text: `Authenticated as ${address}. Session token stored${suffix}` }],
            };
        }

        // AGW mode: Device Authorization flow (asynchronous, browser approval).
        if (!force && context.session.isAuthenticated()) {
            return { content: [{ type: 'text', text: 'Already authenticated. Session is active.' }] };
        }

        const pending = authService.getPendingAuth();
        if (pending) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Authentication already in progress. Ask the user to open this URL to approve:\n${pending.verificationUrl}`,
                    },
                ],
            };
        }

        const result = await authService.authenticateDevice();
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        'Ask the user to open this URL in their browser to approve the session:',
                        result.verificationUrl,
                        '',
                        'Polling for approval in the background...',
                    ].join('\n'),
                },
            ],
        };
    });
}
