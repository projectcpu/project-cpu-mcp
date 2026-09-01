import { PayboxCoordinator } from '../paybox/auth/coordinator.js';
import { PayboxWalletSelectionError } from '../paybox/errors.js';
import { PayboxErrorCode } from '../paybox/types.js';
import { WalletMode, type AppContext } from '../types.js';
import { PERSONA_BRIEF_MARKER } from './persona/constants.js';
import { authenticateInputSchema, type ToolRegistrar } from './types.js';

const DESCRIPTION = [
    'Create a blockchain session.',
    'Call this tool when other tools fail with authentication or session errors',
    '(e.g. "not authenticated", "session expired").',
    'In EVM mode this signs in via SIWE locally and stores the token.',
    'In Paybox mode it opens browser authorization and returns the URL as a fallback.',
    'Once authenticated, subsequent wallet-dependent tools will work automatically.',
    'Pass force=true to discard the cached session and authenticate from scratch',
    '(e.g. after the game server was reset and the stored token references a stale user).',
].join(' ');

export function registerAuthenticateTool(server: ToolRegistrar, context: AppContext): void {
    const authService = context.auth;
    const description = context.config.OPERATOR_PERSONA ? `${DESCRIPTION} ${PERSONA_BRIEF_MARKER}` : DESCRIPTION;

    server.registerTool('cpu_authenticate', { description, inputSchema: authenticateInputSchema }, async (args) => {
        const force = args.force ?? false;
        const payboxCredentialId = args.payboxCredentialId ?? null;

        if (context.config.WALLET_MODE === WalletMode.PAYBOX) {
            if (!(context.wallet instanceof PayboxCoordinator)) {
                throw new Error('Paybox wallet mode is not configured.');
            }
            const result = await context.wallet.authenticate({ force, payboxCredentialId });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        if (payboxCredentialId !== null) {
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
        }

        await (force ? authService.reauthenticate() : authService.getAccessToken());
        const address = context.wallet.get().getAddress();
        const suffix = force ? ' (forced fresh SIWE login).' : '.';
        return {
            content: [{ type: 'text', text: `Authenticated as ${address}. Session token stored${suffix}` }],
        };
    });
}
