import type { AppContext } from '../../types.js';
import { errorMessage } from '../../utils/error.utils.js';

// Returns null instead of throwing when the wallet isn't usable yet, so map reads still work
// pre-authentication (the map is public) — only the owner-scoped figures are then unavailable.
export function getWalletAddress(context: AppContext): string | null {
    if (!context.wallet.isReady()) {
        return null;
    }
    try {
        return context.wallet.get().getAddress();
    } catch (error) {
        context.logger.warn('failed to read wallet address', { error: errorMessage(error) });
        return null;
    }
}
