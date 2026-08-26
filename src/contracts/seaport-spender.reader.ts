import type { Abi, Address } from 'viem';

import {
    SEAPORT_ADDRESS,
    SEAPORT_CONDUIT_REGISTRY_ABI,
    SEAPORT_INFORMATION_ABI,
    SEAPORT_NO_CONDUIT_KEY,
} from './seaport.constants.js';
import {
    SeaportSpenderOutcome,
    type ISeaportSpenderReader,
    type SeaportSpenderAnswer,
    type SeaportSpenderReaderOptions,
} from './seaport.types.js';
import { errorMessage } from '../utils/error.utils.js';
import type { WalletProvider } from '../wallet/types.js';

const CONDUIT_REGISTRY_OUTPUT_INDEX = 2;

function resolved(address: string): SeaportSpenderAnswer {
    return { outcome: SeaportSpenderOutcome.Resolved, address, detail: null };
}

function unregistered(detail: string): SeaportSpenderAnswer {
    return { outcome: SeaportSpenderOutcome.Unregistered, address: null, detail };
}

function unreachable(detail: string): SeaportSpenderAnswer {
    return { outcome: SeaportSpenderOutcome.Unreachable, address: null, detail };
}

function isNoConduitKey(conduitKey: string): boolean {
    return conduitKey.toLowerCase() === SEAPORT_NO_CONDUIT_KEY;
}

export class SeaportSpenderReader implements ISeaportSpenderReader {
    private readonly wallet: WalletProvider;

    constructor(options: SeaportSpenderReaderOptions) {
        this.wallet = options.wallet;
    }

    async spenderForConduitKey(conduitKey: string): Promise<SeaportSpenderAnswer> {
        if (isNoConduitKey(conduitKey)) {
            return resolved(SEAPORT_ADDRESS);
        }

        const registry = await this.conduitRegistry();
        if (registry.address === null) {
            return registry;
        }

        let answer: unknown;
        try {
            answer = await this.wallet.get().readContract({
                address: registry.address as Address,
                abi: SEAPORT_CONDUIT_REGISTRY_ABI as unknown as Abi,
                functionName: 'getConduit',
                args: [conduitKey],
            });
        } catch (error) {
            return unreachable(
                `the protocol's conduit registry ${registry.address} did not answer which contract conduit key ` +
                    `${conduitKey} names: ${errorMessage(error)}`,
            );
        }

        const conduit = Array.isArray(answer) ? answer[0] : null;
        const exists = Array.isArray(answer) ? answer[1] : null;
        if (typeof conduit !== 'string' || exists !== true) {
            return unregistered(
                `conduit key ${conduitKey} names no contract the protocol's conduit registry ${registry.address} ` +
                    'has ever deployed',
            );
        }

        return resolved(conduit);
    }

    async registeredSpender(spender: string): Promise<SeaportSpenderAnswer> {
        if (spender.toLowerCase() === SEAPORT_ADDRESS.toLowerCase()) {
            return resolved(SEAPORT_ADDRESS);
        }

        const registry = await this.conduitRegistry();
        if (registry.address === null) {
            return registry;
        }

        // The registry reverts for an address it never deployed. The read above just succeeded against
        // the same node, so a failure here is that refusal rather than an unreachable chain.
        let key: unknown;
        try {
            key = await this.wallet.get().readContract({
                address: registry.address as Address,
                abi: SEAPORT_CONDUIT_REGISTRY_ABI as unknown as Abi,
                functionName: 'getKey',
                args: [spender as Address],
            });
        } catch {
            return unregistered(
                `${spender} is neither the protocol contract ${SEAPORT_ADDRESS} nor a conduit its registry ` +
                    `${registry.address} has deployed`,
            );
        }

        if (typeof key !== 'string' || isNoConduitKey(key)) {
            return unregistered(
                `the protocol's conduit registry ${registry.address} holds no conduit key for ${spender}`,
            );
        }

        return resolved(spender);
    }

    private async conduitRegistry(): Promise<SeaportSpenderAnswer> {
        let information: unknown;

        try {
            information = await this.wallet.get().readContract({
                address: SEAPORT_ADDRESS,
                abi: SEAPORT_INFORMATION_ABI as unknown as Abi,
                functionName: 'information',
                args: [],
            });
        } catch (error) {
            return unreachable(
                `the protocol contract ${SEAPORT_ADDRESS} did not answer which conduit registry it settles ` +
                    `through: ${errorMessage(error)}`,
            );
        }

        const registry = Array.isArray(information) ? information[CONDUIT_REGISTRY_OUTPUT_INDEX] : null;
        if (typeof registry !== 'string') {
            return unreachable(
                `the protocol contract ${SEAPORT_ADDRESS} named its conduit registry with something that is not ` +
                    'an address',
            );
        }

        return resolved(registry);
    }
}
