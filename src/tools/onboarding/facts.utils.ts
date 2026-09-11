import { EMPTY_ONBOARDING_FACTS } from './constants.js';
import type { OnboardingFacts } from './types.js';
import { MapScope } from '../../map/types.js';
import { currentOnboardingStep } from '../../onboarding/onboarding.utils.js';
import { type OnboardingStatus, OnboardingStep } from '../../onboarding/types.js';
import type { AppContext } from '../../types.js';
import { getWalletAddress } from '../map/wallet.utils.js';

function readAddress(context: AppContext): string | null {
    try {
        return getWalletAddress(context);
    } catch {
        return null;
    }
}

async function readCellCount(context: AppContext, ownerAddress: string): Promise<number | null> {
    try {
        const result = await context.mapReader.query({
            scope: MapScope.Summary,
            tokenIds: null,
            around: null,
            ownerAddress,
        });
        return result.summary.myCells;
    } catch {
        return null;
    }
}

export async function readOnboardingFacts(context: AppContext, status: OnboardingStatus): Promise<OnboardingFacts> {
    const state = status.state;
    const step = state === null ? null : currentOnboardingStep(state);
    if (step !== OnboardingStep.WalletAndCell) {
        return EMPTY_ONBOARDING_FACTS;
    }

    const walletAddress = readAddress(context);
    if (walletAddress === null) {
        return EMPTY_ONBOARDING_FACTS;
    }
    return { walletAddress, cellCount: await readCellCount(context, walletAddress) };
}
