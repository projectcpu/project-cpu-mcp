import { z } from 'zod';

import type { AppContext } from '../types.js';
import { PERSONA_BRIEF_MARKER } from './persona/constants.js';
import type { ToolRegistrar } from './types.js';

const DESCRIPTION = [
    'Create a blockchain session.',
    'Call this tool when other tools fail with authentication or session errors',
    '(e.g. "not authenticated", "session expired").',
    'It signs in via SIWE locally with the configured private key and stores the token.',
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
    const description = context.config.OPERATOR_PERSONA ? `${DESCRIPTION} ${PERSONA_BRIEF_MARKER}` : DESCRIPTION;

    server.registerTool('cpu_authenticate', { description, inputSchema }, async (args) => {
        const force = args.force ?? false;

        // getAccessToken returns the cached token if still valid; force re-runs SIWE login regardless.
        await (force ? authService.reauthenticate() : authService.getAccessToken());
        const address = context.wallet.get().getAddress();
        const suffix = force ? ' (forced fresh SIWE login).' : '.';
        return {
            content: [{ type: 'text', text: `Authenticated as ${address}. Session token stored${suffix}` }],
        };
    });
}
