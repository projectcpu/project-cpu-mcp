import { type Abi, encodeErrorResult, type Hash } from 'viem';
import { describe, expect, it } from 'vitest';

import { TRANSPORT_ABI } from '../../contracts/transport.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type {
    ConfirmedTx,
    GasEstimateRequest,
    IContractClient,
    ReadContractParams,
    TransactionRequest,
} from '../../wallet/types.js';
import { TransportClient } from '../transport.client.js';
import type { QuoteRouteParams } from '../types.js';
import { TRANSPORT, WALLET_ADDRESS } from './service-fakes.js';

const PARAMS: QuoteRouteParams = {
    transport: TRANSPORT,
    from: WALLET_ADDRESS,
    tokenIds: [72n, 73n],
    res: 5,
    amount: 100n,
};

class FakeContracts implements IContractClient {
    constructor(private readonly result: unknown) {}

    async read<T>(_params: ReadContractParams): Promise<T> {
        if (this.result instanceof Error) {
            throw this.result;
        }
        return this.result as T;
    }

    async estimateGas(_tx: GasEstimateRequest): Promise<bigint> {
        throw new Error('unused');
    }

    async send(_tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        throw new Error('unused');
    }

    async confirm(): Promise<ConfirmedTx> {
        throw new Error('unused');
    }
}

function client(result: unknown): TransportClient {
    return new TransportClient({ contracts: new FakeContracts(result), logger: new NoopLogger() });
}

describe('TransportClient', () => {
    it('returns the four-field quote unchanged', async () => {
        await expect(client([10n, 2n, 4n, 1000n]).quoteRoute(PARAMS)).resolves.toEqual({
            totalFee: 10n,
            discount: 2n,
            totalDistance: 4n,
            arrivalAt: 1000n,
        });
    });

    it('turns StorageFull into a business refusal naming the destination and cargo', async () => {
        const data = encodeErrorResult({ abi: TRANSPORT_ABI, errorName: 'StorageFull' });
        const failure = new Error('Execution reverted', { cause: { data } });

        await expect(client(failure).quoteRoute(PARAMS)).rejects.toThrow(
            /destination cell 73 has no room for 100 units of resource 5.*pending production.*nothing was approved/is,
        );
    });

    it('preserves unrelated route reverts', async () => {
        const failure = new Error('HopOutOfRange');

        await expect(client(failure).quoteRoute(PARAMS)).rejects.toBe(failure);
    });
});
