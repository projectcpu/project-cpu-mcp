import {
    getAddress,
    type Hash,
    type Hex,
    parseEther,
    serializeTransaction,
    type TransactionSerializableEIP1559,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationRequiredError } from '../../api/authentication-required.error.js';
import type { ApiClient } from '../../api/client.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ILogger, LogMeta } from '../../logger/types.js';
import { AuthService } from '../../services/auth.service.js';
import type { SessionManager } from '../../session/manager.js';
import { SessionStatus } from '../../session/types.js';
import { TxStatus } from '../../wallet/types.js';
import {
    PayboxAuthInvalidError,
    PayboxInvalidOperationArtifactError,
    PayboxOperationDeniedError,
    PayboxOperationIncompleteError,
    PayboxTemporarilyUnavailableError,
} from '../errors.js';
import { PayboxResetCause } from '../types.js';
import type {
    IPayboxRpcClient,
    IPayboxSdkAdapter,
    PayboxTransactionIntent,
    PayboxTokens,
    PayboxWalletAuthority,
} from '../types.js';
import { PayboxWalletManager } from '../wallet/manager.js';
import { verifiedPayboxTransaction } from '../wallet/utils.js';

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const otherKey = '0x8b3a350cf5c34c9194ca3a545d9b5d4a1f0abf1c9f3c2bb18ce19e6f01a82652';
const account = privateKeyToAccount(key);
const other = privateKeyToAccount(otherKey);
const destination = getAddress('0x0000000000000000000000000000000000001234');
const hash = `0x${'1'.repeat(64)}` as Hash;
const tokens: PayboxTokens = {
    clientId: 'client',
    accessToken: 'access',
    refreshToken: null,
    expiresAt: null,
    resource: null,
    baseUrl: 'https://api.paybox.test',
};
const intent: PayboxTransactionIntent = {
    to: destination,
    value: parseEther('0.5'),
    data: '0x1234',
    chainId: 4663,
    gas: 45_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    nonce: 7,
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function signed(transaction: PayboxTransactionIntent = intent, signer = account): Promise<Hex> {
    return signer.signTransaction({ ...transaction, type: 'eip1559' });
}

function rpc(overrides: Partial<IPayboxRpcClient> = {}): IPayboxRpcClient {
    return {
        getPendingNonce: vi.fn(async () => intent.nonce),
        estimateEip1559Fees: vi.fn(async () => ({
            maxPriorityFeePerGas: intent.maxPriorityFeePerGas,
            maxFeePerGas: intent.maxFeePerGas,
        })),
        estimateGas: vi.fn(async () => intent.gas),
        sendRawTransaction: vi.fn(async () => hash),
        getGasPrice: vi.fn(async () => 1n),
        waitForReceipt: vi.fn(async () => ({
            status: TxStatus.Success,
            transactionHash: hash,
            blockNumber: 99n,
            logs: [],
        })),
        readContract: vi.fn(async () => 42n),
        getBalance: vi.fn(async () => 12n),
        ...overrides,
    };
}

function manager(sdk: Partial<IPayboxSdkAdapter>, rpcClient: IPayboxRpcClient = rpc()): PayboxWalletManager {
    const authority: PayboxWalletAuthority = {
        current: async () => ({ tokens, signingKey: 'pbxk1.key' }),
        invalidate: vi.fn(),
    };
    return new PayboxWalletManager({
        sdk: sdk as IPayboxSdkAdapter,
        credentialId: 'credential-a',
        address: account.address,
        authority,
        rpc: rpcClient,
        logger: new NoopLogger(),
    });
}

class RecordingLogger implements ILogger {
    readonly warnings = new Array<{ message: string; meta: LogMeta | undefined }>();
    readonly info = vi.fn();
    readonly error = vi.fn();
    readonly debug = vi.fn();

    warn(message: string, meta?: LogMeta): void {
        this.warnings.push({ message, meta });
    }
    child(): ILogger {
        return this;
    }
}

describe('verifiedPayboxTransaction', () => {
    it('accepts only the exact selected-wallet EIP-1559 artifact', async () => {
        const artifact = await signed();
        await expect(verifiedPayboxTransaction(intent, artifact, account.address)).resolves.toBe(artifact);
    });

    it.each([
        ['malformed serialized transaction', '0xdeadbeef' as Hex],
        ['mismatched transaction intent', null],
    ])('classifies a %s as an invalid operation artifact', async (_case, malformed) => {
        const artifact = malformed ?? (await signed({ ...intent, value: intent.value + 1n }));

        await expect(verifiedPayboxTransaction(intent, artifact, account.address)).rejects.toBeInstanceOf(
            PayboxInvalidOperationArtifactError,
        );
    });

    it.each([
        [
            'type',
            () =>
                account.signTransaction({
                    to: intent.to,
                    value: intent.value,
                    data: intent.data,
                    chainId: intent.chainId,
                    gas: intent.gas,
                    gasPrice: intent.maxFeePerGas,
                    nonce: intent.nonce,
                    type: 'legacy',
                }),
        ],
        ['destination', () => signed({ ...intent, to: getAddress('0x0000000000000000000000000000000000005678') })],
        ['calldata', () => signed({ ...intent, data: '0xabcd' })],
        ['value', () => signed({ ...intent, value: intent.value + 1n })],
        ['chain', () => signed({ ...intent, chainId: 1 })],
        ['gas', () => signed({ ...intent, gas: intent.gas + 1n })],
        ['priority fee', () => signed({ ...intent, maxPriorityFeePerGas: intent.maxPriorityFeePerGas + 1n })],
        ['maximum fee', () => signed({ ...intent, maxFeePerGas: intent.maxFeePerGas + 1n })],
        ['nonce', () => signed({ ...intent, nonce: intent.nonce + 1 })],
        [
            'access list',
            () =>
                account.signTransaction({
                    ...intent,
                    type: 'eip1559',
                    accessList: [{ address: destination, storageKeys: [] }],
                }),
        ],
    ])('rejects a signed artifact with a mutated %s', async (_field, artifact) => {
        await expect(verifiedPayboxTransaction(intent, await artifact(), account.address)).rejects.toBeInstanceOf(
            PayboxInvalidOperationArtifactError,
        );
    });

    it('rejects malformed and unsigned artifacts', async () => {
        await expect(verifiedPayboxTransaction(intent, '0xdeadbeef', account.address)).rejects.toBeInstanceOf(
            PayboxInvalidOperationArtifactError,
        );
        const unsigned = serializeTransaction({ ...intent, type: 'eip1559' } as TransactionSerializableEIP1559);
        await expect(verifiedPayboxTransaction(intent, unsigned, account.address)).rejects.toBeInstanceOf(
            PayboxInvalidOperationArtifactError,
        );
    });

    it('marks a wrong transaction signer as confirmed invalid key binding', async () => {
        await expect(
            verifiedPayboxTransaction(intent, await signed(intent, other), account.address),
        ).rejects.toBeInstanceOf(PayboxAuthInvalidError);
    });
});

describe('PayboxWalletManager', () => {
    it.each([
        ['ordinary denial', new PayboxOperationDeniedError(), PayboxOperationDeniedError],
        ['temporary outage', new PayboxTemporarilyUnavailableError(), PayboxTemporarilyUnavailableError],
        ['incomplete operation', new PayboxOperationIncompleteError(), PayboxOperationIncompleteError],
        [
            'malformed operation artifact',
            new PayboxInvalidOperationArtifactError(),
            PayboxInvalidOperationArtifactError,
        ],
    ])('preserves authority and never broadcasts after %s', async (_case, signingError, errorType) => {
        const invalidate = vi.fn();
        const rpcClient = rpc();
        const logger = new RecordingLogger();
        const signTransaction = vi.fn(async () => Promise.reject(signingError));
        const wallet = new PayboxWalletManager({
            sdk: { signTransaction } as unknown as IPayboxSdkAdapter,
            credentialId: 'credential-a',
            address: account.address,
            authority: {
                current: async () => ({ tokens, signingKey: 'pbxk1.key' }),
                invalidate,
            },
            rpc: rpcClient,
            logger,
        });

        await expect(
            wallet.sendTransaction({ to: destination, data: intent.data, value: intent.value, gas: null }),
        ).rejects.toBeInstanceOf(errorType);
        expect(signTransaction).toHaveBeenCalledOnce();
        expect(invalidate).not.toHaveBeenCalled();
        expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled();
        expect(logger.warnings).toEqual([
            {
                message: 'Paybox signing request failed',
                meta: signingError.diagnostic,
            },
        ]);
    });

    it('publishes deterministic recovery and redacted reset diagnostics after confirmed signing failure', async () => {
        const invalidate = vi.fn();
        const rpcClient = rpc();
        const logger = new RecordingLogger();
        const signTransaction = vi.fn(async () => {
            throw new PayboxAuthInvalidError(
                'rejected raw body with access_token=secret',
                PayboxResetCause.AuthenticatedRequestRejected,
            );
        });
        const wallet = new PayboxWalletManager({
            sdk: { signTransaction } as unknown as IPayboxSdkAdapter,
            credentialId: 'credential-a',
            address: account.address,
            authority: {
                current: async () => ({ tokens, signingKey: 'pbxk1.key' }),
                invalidate,
            },
            rpc: rpcClient,
            logger,
        });

        const failure = wallet.sendTransaction({
            to: destination,
            data: intent.data,
            value: intent.value,
            gas: null,
        });

        await expect(failure).rejects.toBeInstanceOf(AuthenticationRequiredError);
        await expect(failure).rejects.toMatchObject({
            data: { code: 'AUTHENTICATION_REQUIRED', stateCleared: true, nextTool: 'cpu_authenticate' },
        });
        await expect(failure).rejects.not.toThrow('secret');
        expect(signTransaction).toHaveBeenCalledOnce();
        expect(invalidate).toHaveBeenCalledOnce();
        expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled();
        expect(logger.warnings).toEqual([
            {
                message: 'Paybox signing authority invalidated',
                meta: {
                    failureClass: 'confirmed_authentication',
                    resetCause: 'authenticated_request_rejected',
                    resetDepth: 'full',
                },
            },
        ]);
    });

    it('publishes the same recovery when current authority proves an invalid refresh before signing', async () => {
        const invalidate = vi.fn();
        const signTransaction = vi.fn();
        const rpcClient = rpc();
        const wallet = new PayboxWalletManager({
            sdk: { signTransaction } as unknown as IPayboxSdkAdapter,
            credentialId: 'credential-a',
            address: account.address,
            authority: {
                current: vi.fn(async () => {
                    throw new PayboxAuthInvalidError('invalid refresh', PayboxResetCause.InvalidRefresh);
                }),
                invalidate,
            },
            rpc: rpcClient,
            logger: new NoopLogger(),
        });

        await expect(
            wallet.sendTransaction({ to: destination, data: intent.data, value: intent.value, gas: null }),
        ).rejects.toBeInstanceOf(AuthenticationRequiredError);
        expect(invalidate).toHaveBeenCalledOnce();
        expect(signTransaction).not.toHaveBeenCalled();
        expect(rpcClient.getPendingNonce).not.toHaveBeenCalled();
        expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled();
    });

    it('loads current coordinator-owned authority before each signing request', async () => {
        const message = 'Project CPU SIWE proof';
        const signature = await account.signMessage({ message });
        const sign = vi.fn(async () => signature);
        const sdk = { signMessage: sign } as unknown as IPayboxSdkAdapter;
        const refreshedTokens = { ...tokens, accessToken: 'rotated-access' };
        const authority: PayboxWalletAuthority = {
            current: vi.fn(async () => ({ tokens: refreshedTokens, signingKey: 'pbxk1.rotated' })),
            invalidate: vi.fn(),
        };
        const wallet = new PayboxWalletManager({
            sdk,
            credentialId: 'credential-a',
            address: account.address,
            authority,
            rpc: rpc(),
            logger: new NoopLogger(),
        });

        await expect(wallet.signMessage(message)).resolves.toBe(signature);
        expect(authority.current).toHaveBeenCalledOnce();
        expect(sign).toHaveBeenCalledWith(refreshedTokens, 'pbxk1.rotated', 'credential-a', message);
    });

    it('returns only a valid EIP-191 signature bound to the selected wallet and credential', async () => {
        const message = 'Project CPU SIWE proof';
        const signature = await account.signMessage({ message });
        const signMessage = vi.fn(async () => signature);
        const wallet = manager({ signMessage });

        await expect(wallet.signMessage(message)).resolves.toBe(signature);
        expect(signMessage).toHaveBeenCalledWith(tokens, 'pbxk1.key', 'credential-a', message);
        expect(wallet.getAddress()).toBe(account.address);
        expect(wallet.getChainId()).toBe(4663);
    });

    it('requires explicit authentication for wrong signer, wrong message, and malformed signatures', async () => {
        const message = 'Project CPU SIWE proof';
        for (const signMessage of [
            vi.fn(async () => other.signMessage({ message })),
            vi.fn(async () => account.signMessage({ message: 'other' })),
            vi.fn(async () => '0xdeadbeef'),
        ]) {
            await expect(manager({ signMessage }).signMessage(message)).rejects.toBeInstanceOf(
                AuthenticationRequiredError,
            );
        }
    });

    it('requires explicit authentication after malformed and wrong-wallet SIWE signatures', async () => {
        const message = 'Project CPU SIWE proof';
        for (const signMessage of [
            vi.fn(async () => other.signMessage({ message })),
            vi.fn(async () => '0xdeadbeef'),
        ]) {
            await expect(manager({ signMessage }).signMessage(message)).rejects.toBeInstanceOf(
                AuthenticationRequiredError,
            );
        }
    });

    it('invalidates coordinator authority after a confirmed signing failure', async () => {
        const invalidate = vi.fn();
        const wallet = new PayboxWalletManager({
            sdk: {
                signMessage: vi.fn(async () => {
                    throw new PayboxAuthInvalidError('signing key rejected');
                }),
            } as unknown as IPayboxSdkAdapter,
            credentialId: 'credential-a',
            address: account.address,
            authority: {
                current: async () => ({ tokens, signingKey: 'pbxk1.key' }),
                invalidate,
            },
            rpc: rpc(),
            logger: new NoopLogger(),
        });

        await expect(wallet.signMessage('Project CPU SIWE proof')).rejects.toBeInstanceOf(AuthenticationRequiredError);
        expect(invalidate).toHaveBeenCalledOnce();
    });

    it('constructs, signs, verifies, and broadcasts an EIP-1559 intent at queue head', async () => {
        const rpcClient = rpc();
        const signTransaction = vi.fn(async (_tokens, _key, _credential, requested: PayboxTransactionIntent) =>
            signed(requested),
        );
        const wallet = manager({ signTransaction }, rpcClient);

        await expect(
            wallet.sendTransaction({ to: destination, data: intent.data, value: intent.value, gas: null }),
        ).resolves.toBe(hash);

        expect(rpcClient.getPendingNonce).toHaveBeenCalledWith(account.address);
        expect(rpcClient.estimateEip1559Fees).toHaveBeenCalledOnce();
        expect(rpcClient.estimateGas).toHaveBeenCalledWith(account.address, {
            to: destination,
            data: intent.data,
            value: intent.value,
        });
        expect(signTransaction).toHaveBeenCalledWith(tokens, 'pbxk1.key', 'credential-a', intent);
        expect(rpcClient.sendRawTransaction).toHaveBeenCalledWith(await signed());
    });

    it('serializes overlapping sends and gives them distinct sequential pending nonces', async () => {
        const firstSignature = deferred<Hex>();
        const firstReachedSigner = deferred<void>();
        const nonces = [7, 8];
        const rpcClient = rpc({ getPendingNonce: vi.fn(async () => nonces.shift() ?? 99) });
        const requested = new Array<PayboxTransactionIntent>();
        const signTransaction = vi.fn(
            async (_tokens, _key, _credential, transaction: PayboxTransactionIntent): Promise<Hex> => {
                requested.push(transaction);
                if (requested.length === 1) {
                    firstReachedSigner.resolve();
                    return firstSignature.promise;
                }
                return signed(transaction);
            },
        );
        const wallet = manager({ signTransaction }, rpcClient);

        const first = wallet.sendTransaction({ to: destination, data: '0x01', value: null, gas: null });
        await firstReachedSigner.promise;
        const second = wallet.sendTransaction({ to: destination, data: '0x02', value: null, gas: null });
        expect(rpcClient.getPendingNonce).toHaveBeenCalledTimes(1);

        firstSignature.resolve(await signed(requested[0] as PayboxTransactionIntent));
        await expect(Promise.all([first, second])).resolves.toEqual([hash, hash]);
        expect(requested.map((transaction) => transaction.nonce)).toEqual([7, 8]);
    });

    it('releases the transaction queue after a failed first send', async () => {
        const firstReachedSigner = deferred<void>();
        let calls = 0;
        const signTransaction = vi.fn(
            async (_tokens, _key, _credential, transaction: PayboxTransactionIntent): Promise<Hex> => {
                calls += 1;
                if (calls === 1) {
                    firstReachedSigner.resolve();
                    throw new Error('signing failed');
                }
                return signed(transaction);
            },
        );
        const wallet = manager({ signTransaction });

        const first = wallet.sendTransaction({ to: destination, data: '0x01', value: null, gas: null });
        await firstReachedSigner.promise;
        const second = wallet.sendTransaction({ to: destination, data: '0x02', value: null, gas: null });

        await expect(first).rejects.toThrow('signing failed');
        await expect(second).resolves.toBe(hash);
        expect(signTransaction).toHaveBeenCalledTimes(2);
    });

    it('rejects malformed, mismatched, and denied signing outcomes before broadcast', async () => {
        for (const outcome of [
            () => Promise.resolve('0xdeadbeef' as Hex),
            () => signed({ ...intent, value: intent.value + 1n }),
            () => Promise.reject(new Error('PAYBOX_OPERATION_DENIED')),
        ]) {
            const rpcClient = rpc();
            const wallet = manager({ signTransaction: vi.fn(outcome) }, rpcClient);
            await expect(
                wallet.sendTransaction({ to: destination, data: intent.data, value: intent.value, gas: null }),
            ).rejects.toThrow();
            expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled();
        }
    });

    it('delegates reads, estimation, balance, gas price, and receipts only to Robinhood RPC', async () => {
        const rpcClient = rpc();
        const wallet = manager({}, rpcClient);
        const read = { address: destination, abi: [], functionName: 'value', args: [] } as const;

        await expect(wallet.estimateGas({ to: destination, data: '0x', value: null })).resolves.toBe(intent.gas);
        await expect(wallet.getGasPrice()).resolves.toBe(1n);
        await expect(wallet.getBalance()).resolves.toBe(12n);
        await expect(wallet.readContract(read)).resolves.toBe(42n);
        await expect(wallet.waitForReceipt(hash)).resolves.toMatchObject({ blockNumber: 99n });
        expect(rpcClient.estimateGas).toHaveBeenCalledWith(account.address, {
            to: destination,
            data: '0x',
            value: null,
        });
        expect(rpcClient.getBalance).toHaveBeenCalledWith(account.address);
        expect(rpcClient.readContract).toHaveBeenCalledWith(read);
        expect(rpcClient.waitForReceipt).toHaveBeenCalledWith(hash);
    });

    it('prevents SIWE verification when the selected-wallet signature check fails', async () => {
        const message = 'unused';
        const wallet = manager({ signMessage: vi.fn(async () => other.signMessage({ message })) });
        const request = vi.fn(async () => ({
            status: 200,
            data: {
                nonce: 'abc123def456',
                issuedAt: new Date().toISOString(),
                expirationTime: new Date(Date.now() + 600_000).toISOString(),
            },
        }));
        const service = new AuthService({
            session: { getStatus: () => SessionStatus.Missing } as unknown as SessionManager,
            api: { getBaseUrl: () => 'https://api.test', request } as unknown as ApiClient,
            wallet: { get: () => wallet, isReady: () => true },
            logger: new NoopLogger(),
        });

        await expect(service.authenticateSiwe()).rejects.toBeInstanceOf(AuthenticationRequiredError);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
