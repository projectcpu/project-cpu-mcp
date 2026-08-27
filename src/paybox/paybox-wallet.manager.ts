import { getAddress, type Address, type Hash, type Hex } from 'viem';

import { verifiedPayboxMessageSignature } from './paybox-wallet.utils.js';
import type { IPayboxSdkAdapter, PayboxTokens, PayboxWalletAuthority } from './types.js';
import { LAUNCH_CHAIN_ID } from '../config/constants.js';
import type {
    GasEstimateRequest,
    ReadContractParams,
    TransactionRequest,
    TxReceipt,
    WalletManager,
} from '../wallet/types.js';

export class PayboxWalletManager implements WalletManager {
    private readonly address: Address;

    public constructor(
        private readonly sdk: IPayboxSdkAdapter,
        _tokens: PayboxTokens,
        _signingKey: string,
        private readonly credentialId: string,
        address: string,
        private readonly authority: PayboxWalletAuthority,
    ) {
        this.address = getAddress(address);
    }

    public getAddress(): Address {
        return this.address;
    }

    public getChainId(): number {
        return LAUNCH_CHAIN_ID;
    }

    public async signMessage(message: string): Promise<Hex> {
        const authority = await this.authority.current();
        const signature = await this.sdk.signMessage(
            authority.tokens,
            authority.signingKey,
            this.credentialId,
            message,
        );
        return verifiedPayboxMessageSignature(message, signature as Hex, this.address);
    }

    public async sendTransaction(_tx: TransactionRequest): Promise<Hash> {
        return this.unsupported();
    }

    public async estimateGas(_tx: GasEstimateRequest): Promise<bigint> {
        return this.unsupported();
    }

    public async getGasPrice(): Promise<bigint> {
        return this.unsupported();
    }

    public async waitForReceipt(_hash: Hash): Promise<TxReceipt> {
        return this.unsupported();
    }

    public async readContract(_params: ReadContractParams): Promise<unknown> {
        return this.unsupported();
    }

    public async getBalance(): Promise<bigint> {
        return this.unsupported();
    }

    private unsupported(): never {
        throw new Error('Paybox transaction support is not available yet.');
    }
}
