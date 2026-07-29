import { encodeFunctionData, type Hash } from 'viem';

import type {
    FinalizeParams,
    ITransportClient,
    MoveParams,
    QuoteRouteParams,
    RouteQuote,
    TransportClientOptions,
} from './types.js';
import { TRANSPORT_ABI } from '../contracts/transport.abi.js';
import type { ILogger } from '../logger/types.js';
import type { IContractClient } from '../wallet/types.js';

export class TransportClient implements ITransportClient {
    private readonly contracts: IContractClient;
    private readonly logger: ILogger;

    constructor(options: TransportClientOptions) {
        this.contracts = options.contracts;
        this.logger = options.logger;
    }

    async quoteRoute(params: QuoteRouteParams): Promise<RouteQuote> {
        const [totalFee, discount, totalDistance, arrivalAt] = await this.contracts.read<
            readonly [bigint, bigint, bigint, bigint]
        >({
            address: params.transport,
            abi: TRANSPORT_ABI,
            functionName: 'quoteRoute',
            args: [params.from, params.tokenIds, params.res, params.amount],
        });
        return { totalFee, discount, totalDistance, arrivalAt };
    }

    async move(params: MoveParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRANSPORT_ABI,
            functionName: 'move',
            args: [params.tokenIds, params.res, params.amount, params.maxFee],
        });
        this.logger.info('submitting transport move', {
            transport: params.transport,
            res: params.res,
            amount: params.amount.toString(),
            maxFeeWei: params.maxFee.toString(),
        });
        return this.contracts.send({ to: params.transport, data, value: null, gas: null }, TRANSPORT_ABI);
    }

    async finalize(params: FinalizeParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRANSPORT_ABI,
            functionName: 'finalizeMany',
            args: [params.ids],
        });
        this.logger.info('finalizing deliveries', {
            transport: params.transport,
            ids: params.ids.map((id) => id.toString()),
        });
        return this.contracts.send({ to: params.transport, data, value: null, gas: null }, TRANSPORT_ABI);
    }
}
