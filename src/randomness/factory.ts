import { isAddress, zeroAddress, type Address } from 'viem';

import { BeaconClient } from './beacon.client.js';
import { DrandRandomnessStrategy } from './drand.strategy.js';
import { PushRandomnessStrategy } from './push.strategy.js';
import type { IRandomnessStrategyFactory, RandomnessStrategy, RandomnessStrategyFactoryOptions } from './types.js';
import { type IRevealRequestsReader, type RandomnessDescriptor, RandomnessKind } from '../api/types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class RandomnessStrategyFactory implements IRandomnessStrategyFactory {
    private readonly contracts: IContractClient;
    private readonly wallet: WalletProvider;
    private readonly revealRequests: IRevealRequestsReader;
    private readonly logger: ILogger;

    constructor(options: RandomnessStrategyFactoryOptions) {
        this.contracts = options.contracts;
        this.wallet = options.wallet;
        this.revealRequests = options.revealRequests;
        this.logger = options.logger;
    }

    async create(descriptor: RandomnessDescriptor, cell: Address): Promise<RandomnessStrategy> {
        switch (descriptor.kind) {
            case RandomnessKind.ENTROPY: {
                const source = await this.resolveSource(descriptor, cell);
                return new PushRandomnessStrategy({ source, contracts: this.contracts, logger: this.logger });
            }
            case RandomnessKind.DRAND: {
                const source = await this.resolveSource(descriptor, cell);
                return new DrandRandomnessStrategy({
                    source,
                    clock: { genesis: descriptor.genesis, period: descriptor.period },
                    beacon: new BeaconClient({ baseUrl: descriptor.beaconApi, logger: this.logger.child('beacon') }),
                    contracts: this.contracts,
                    wallet: this.wallet,
                    revealRequests: this.revealRequests,
                    logger: this.logger,
                });
            }
            default: {
                const unsupported: never = descriptor;
                throw new Error(
                    `GET /api/v1/config serves a randomness descriptor this client build has no strategy for: ` +
                        `${JSON.stringify(unsupported)}.`,
                );
            }
        }
    }

    private async resolveSource(descriptor: RandomnessDescriptor, cell: Address): Promise<Address> {
        const configured = descriptor.adapter.trim();
        if (configured.length > 0) {
            if (!isAddress(configured, { strict: false })) {
                throw new Error(
                    `GET /api/v1/config serves randomness adapter "${configured}", which is not an address.`,
                );
            }
            this.logger.info('using the configured randomness source', { source: configured, kind: descriptor.kind });
            return configured;
        }

        const onChain = await this.contracts.read<Address>({
            address: cell,
            abi: CELL_ABI,
            functionName: 'randomnessSource',
            args: [],
        });
        if (onChain === zeroAddress || !isAddress(onChain, { strict: false })) {
            throw new Error(
                `GET /api/v1/config serves no randomness adapter address and Cell ${cell} has no randomness ` +
                    `source set on this deployment; reveal is unavailable.`,
            );
        }
        this.logger.info('read the randomness source off the cell', { cell, source: onChain, kind: descriptor.kind });
        return onChain;
    }
}
