import type { Address } from 'viem';

import type { PushRandomness, PushRandomnessOptions } from './types.js';
import { RandomnessKind } from '../api/types.js';
import { RANDOMNESS_SOURCE_ABI } from '../contracts/randomness-source.abi.js';
import type { ILogger } from '../logger/types.js';
import type { IContractClient } from '../wallet/types.js';

export class PushRandomnessStrategy implements PushRandomness {
    public readonly kind: RandomnessKind.ENTROPY = RandomnessKind.ENTROPY;
    public readonly source: Address;
    private readonly contracts: IContractClient;
    private readonly logger: ILogger;

    constructor(options: PushRandomnessOptions) {
        this.source = options.source;
        this.contracts = options.contracts;
        this.logger = options.logger;
    }

    async quoteFee(): Promise<bigint> {
        const fee = await this.contracts.read<bigint>({
            address: this.source,
            abi: RANDOMNESS_SOURCE_ABI,
            functionName: 'quoteFee',
            args: [],
        });
        this.logger.info('quoted randomness fee', { source: this.source, kind: this.kind, feeWei: fee.toString() });
        return fee;
    }
}
