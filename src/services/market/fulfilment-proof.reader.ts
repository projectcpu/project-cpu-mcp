import { createPublicClient, http, type Hash } from 'viem';

import type { IFulfilmentTransactionReader, RpcTransactionReaderOptions } from './fulfilment-proof.types.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';
import { viemChainForChainId } from '../../wallet/chain.utils.js';

export class RpcTransactionReader implements IFulfilmentTransactionReader {
    private readonly client;
    private readonly logger: ILogger;

    constructor(options: RpcTransactionReaderOptions) {
        this.client = createPublicClient({
            chain: viemChainForChainId(options.chainId),
            transport: options.rpcUrl !== null ? http(options.rpcUrl) : http(),
        });
        this.logger = options.logger;
    }

    async senderOf(txHash: string): Promise<string | null> {
        try {
            const transaction = await this.client.getTransaction({ hash: txHash as Hash });
            return transaction.from;
        } catch (error) {
            this.logger.warn('could not read back the wallet that sent a mined transaction', {
                txHash,
                reason: errorMessage(error),
            });
            return null;
        }
    }
}
