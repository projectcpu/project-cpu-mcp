import { encodeFunctionData, type Address } from 'viem';

import type {
    CreateRegistryParams,
    ISyndicateRegistryClient,
    JoinRegistryParams,
    LeaveRegistryParams,
    SetParamsRegistryParams,
    SyndicateRegistryClientOptions,
    SyndicateRegistryConfig,
    TransferManagerRegistryParams,
} from './types.js';
import { SYNDICATE_ABI } from '../contracts/syndicate.abi.js';
import type { ILogger } from '../logger/types.js';
import type { ConfirmedTx, IContractClient } from '../wallet/types.js';

export class SyndicateRegistryClient implements ISyndicateRegistryClient {
    private readonly contracts: IContractClient;
    private readonly logger: ILogger;

    constructor(options: SyndicateRegistryClientOptions) {
        this.contracts = options.contracts;
        this.logger = options.logger;
    }

    async join(params: JoinRegistryParams): Promise<ConfirmedTx> {
        const data = encodeFunctionData({ abi: SYNDICATE_ABI, functionName: 'join', args: [params.id] });
        this.logger.info('joining syndicate', { registry: params.registry, id: params.id.toString() });
        const hash = await this.contracts.send({ to: params.registry, data, value: null, gas: null }, SYNDICATE_ABI);
        return this.contracts.confirm(hash, 'Join syndicate');
    }

    async leave(params: LeaveRegistryParams): Promise<ConfirmedTx> {
        const data = encodeFunctionData({ abi: SYNDICATE_ABI, functionName: 'leave', args: [] });
        this.logger.info('leaving syndicate', { registry: params.registry });
        const hash = await this.contracts.send({ to: params.registry, data, value: null, gas: null }, SYNDICATE_ABI);
        return this.contracts.confirm(hash, 'Leave syndicate');
    }

    async create(params: CreateRegistryParams): Promise<ConfirmedTx> {
        const data = encodeFunctionData({
            abi: SYNDICATE_ABI,
            functionName: 'create',
            args: [params.name, params.link, params.manager, params.rates],
        });
        this.logger.info('creating syndicate', { registry: params.registry, manager: params.manager });
        const hash = await this.contracts.send({ to: params.registry, data, value: null, gas: null }, SYNDICATE_ABI);
        return this.contracts.confirm(hash, 'Create syndicate');
    }

    async setParams(params: SetParamsRegistryParams): Promise<ConfirmedTx> {
        const data = encodeFunctionData({
            abi: SYNDICATE_ABI,
            functionName: 'setParams',
            args: [params.id, params.name, params.link, params.rates],
        });
        this.logger.info('updating syndicate params', { registry: params.registry, id: params.id.toString() });
        const hash = await this.contracts.send({ to: params.registry, data, value: null, gas: null }, SYNDICATE_ABI);
        return this.contracts.confirm(hash, 'Update syndicate params');
    }

    async transferManager(params: TransferManagerRegistryParams): Promise<ConfirmedTx> {
        const data = encodeFunctionData({
            abi: SYNDICATE_ABI,
            functionName: 'transferManager',
            args: [params.id, params.next],
        });
        this.logger.info('transferring syndicate manager', {
            registry: params.registry,
            id: params.id.toString(),
            next: params.next,
        });
        const hash = await this.contracts.send({ to: params.registry, data, value: null, gas: null }, SYNDICATE_ABI);
        return this.contracts.confirm(hash, 'Transfer syndicate manager');
    }

    async getConfig(registry: Address): Promise<SyndicateRegistryConfig> {
        const config = await this.contracts.read<{ exitCooldownSec: bigint }>({
            address: registry,
            abi: SYNDICATE_ABI,
            functionName: 'getConfig',
            args: [],
        });
        return { exitCooldownSec: Number(config.exitCooldownSec) };
    }
}
