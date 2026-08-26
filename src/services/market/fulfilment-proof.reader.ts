import type { Hash } from 'viem';

import type { IFulfilmentTransactionReader, WalletTransactionReaderOptions } from './fulfilment-proof.types.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';
import type { WalletProvider } from '../../wallet/types.js';

export class WalletTransactionReader implements IFulfilmentTransactionReader {
    private readonly wallet: WalletProvider;
    private readonly logger: ILogger;

    constructor(options: WalletTransactionReaderOptions) {
        this.wallet = options.wallet;
        this.logger = options.logger;
    }

    async senderOf(txHash: string): Promise<string | null> {
        try {
            return await this.wallet.get().getTransactionSender(txHash as Hash);
        } catch (error) {
            this.logger.warn('could not read back the wallet that sent a mined transaction', {
                txHash,
                reason: errorMessage(error),
            });
            return null;
        }
    }
}
