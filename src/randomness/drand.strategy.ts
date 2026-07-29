import { encodeFunctionData, zeroAddress, type Address } from 'viem';

import { describeAdapterFailure } from './adapter-revert.utils.js';
import { pickOpenRequest, pickRetiredSourceRequest } from './request.utils.js';
import {
    AdapterRequestState,
    type AdapterRequestView,
    type BeaconRoundClock,
    type FulfillmentInput,
    type FulfillmentResult,
    type IBeaconClient,
    type OpenRequestMatch,
    type SelfServiceRandomness,
    type SelfServiceRandomnessOptions,
} from './types.js';
import { type IRevealRequestsReader, RandomnessKind } from '../api/types.js';
import { RANDOMNESS_ADAPTER_ABI } from '../contracts/randomness-adapter.abi.js';
import type { ILogger } from '../logger/types.js';
import { bufferedGasLimit } from '../wallet/gas.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class DrandRandomnessStrategy implements SelfServiceRandomness {
    public readonly kind: RandomnessKind.DRAND = RandomnessKind.DRAND;
    public readonly source: Address;
    public readonly clock: BeaconRoundClock;
    public readonly beacon: IBeaconClient;
    private readonly contracts: IContractClient;
    private readonly wallet: WalletProvider;
    private readonly revealRequests: IRevealRequestsReader;
    private readonly logger: ILogger;

    constructor(options: SelfServiceRandomnessOptions) {
        this.source = options.source;
        this.clock = options.clock;
        this.beacon = options.beacon;
        this.contracts = options.contracts;
        this.wallet = options.wallet;
        this.revealRequests = options.revealRequests;
        this.logger = options.logger;
    }

    async quoteRequestFee(): Promise<bigint> {
        const gasPrice = await this.wallet.get().getGasPrice();
        const fee = await this.contracts.read<bigint>({
            address: this.source,
            abi: RANDOMNESS_ADAPTER_ABI,
            functionName: 'quoteFeeAt',
            args: [gasPrice],
        });
        this.logger.info('quoted randomness fee at the current gas price', {
            source: this.source,
            kind: this.kind,
            gasPriceWei: gasPrice.toString(),
            feeWei: fee.toString(),
        });
        return fee;
    }

    async readRequest(requestId: bigint): Promise<AdapterRequestView> {
        const [consumer, round] = await this.contracts.read<readonly [Address, bigint]>({
            address: this.source,
            abi: RANDOMNESS_ADAPTER_ABI,
            functionName: 'requestOf',
            args: [requestId],
        });
        const state = consumer === zeroAddress ? AdapterRequestState.CLOSED : AdapterRequestState.OPEN;
        this.logger.debug('read the reveal request at the randomness source', {
            source: this.source,
            requestId: requestId.toString(),
            state,
            consumer,
            round: round.toString(),
        });
        return { state, requestId, consumer, round };
    }

    async findOpenRequest(owner: Address, tokenId: string): Promise<OpenRequestMatch | null> {
        const view = await this.revealRequests.listOpenRequests(owner);
        const row = pickOpenRequest(view.requests, this.source, tokenId);
        if (row === null) {
            this.logger.debug('no open reveal request for the cell at the current randomness source', {
                source: this.source,
                tokenId,
                open: view.requests.length,
            });
            return null;
        }
        this.logger.info('found an open reveal request for the cell', {
            source: this.source,
            tokenId,
            requestId: row.requestId.toString(),
        });
        return { ...row, serverTime: view.serverTime };
    }

    async findRetiredSourceRequest(owner: Address, tokenId: string): Promise<OpenRequestMatch | null> {
        const view = await this.revealRequests.listOpenRequests(owner);
        const row = pickRetiredSourceRequest(view.requests, this.source, tokenId);
        if (row === null) {
            return null;
        }
        this.logger.info('found an open reveal request for the cell at a source the chain config has replaced', {
            source: this.source,
            retiredSource: row.source,
            tokenId,
            requestId: row.requestId.toString(),
        });
        return { ...row, serverTime: view.serverTime };
    }

    async fulfill(input: FulfillmentInput): Promise<FulfillmentResult> {
        const data = encodeFunctionData({
            abi: RANDOMNESS_ADAPTER_ABI,
            functionName: 'fulfillReveal',
            args: [input.requestId, input.round, input.signature],
        });
        this.logger.info('submitting reveal fulfilment', {
            source: this.source,
            requestId: input.requestId.toString(),
            round: input.round.toString(),
        });

        const call = { to: this.source, data, value: null };
        try {
            const gas = bufferedGasLimit(await this.contracts.estimateGas(call));
            const txHash = await this.contracts.send({ ...call, gas }, RANDOMNESS_ADAPTER_ABI);
            return {
                state: AdapterRequestState.OPEN,
                requestId: input.requestId,
                round: input.round,
                txHash,
            };
        } catch (error) {
            const failure = describeAdapterFailure(error);
            if (failure === null) {
                throw error;
            }
            if (failure.alreadyFulfilled) {
                this.logger.info('the reveal request was already fulfilled', {
                    source: this.source,
                    requestId: input.requestId.toString(),
                });
                return {
                    state: AdapterRequestState.CLOSED,
                    requestId: input.requestId,
                    round: input.round,
                    reason: failure.message,
                };
            }
            this.logger.error('the randomness source rejected the fulfilment', {
                source: this.source,
                requestId: input.requestId.toString(),
                round: input.round.toString(),
                error: failure.name,
            });
            throw new Error(failure.message, { cause: error });
        }
    }
}
