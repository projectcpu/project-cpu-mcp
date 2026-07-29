import { backoffDelayMs } from './backoff.utils.js';
import { FULFILMENT_REVERT_LABEL, FULFILMENT_SWEEP_INTERVAL_MS } from './constants.js';
import { fulfilmentKey, sameAddress, toOpenRequestRow } from './request.utils.js';
import {
    AdapterRequestState,
    BeaconRoundOutcome,
    type IFulfilmentClaims,
    type ISelfServiceRandomnessResolver,
    type OpenRequestRow,
    type RequestBackoff,
    type RevealFulfillerOptions,
    type SelfServiceRandomness,
} from './types.js';
import type { IRevealRequestsReader } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class RevealFulfiller {
    private readonly randomness: ISelfServiceRandomnessResolver;
    private readonly revealRequests: IRevealRequestsReader;
    private readonly contracts: IContractClient;
    private readonly wallet: WalletProvider;
    private readonly claims: IFulfilmentClaims;
    private readonly logger: ILogger;
    private readonly backoff = new Map<string, RequestBackoff>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private sweeping = false;

    constructor(options: RevealFulfillerOptions) {
        this.randomness = options.randomness;
        this.revealRequests = options.revealRequests;
        this.contracts = options.contracts;
        this.wallet = options.wallet;
        this.claims = options.claims;
        this.logger = options.logger;
    }

    start(): void {
        if (this.timer !== null) {
            return;
        }
        this.logger.info('starting background reveal fulfilment', {
            intervalMs: FULFILMENT_SWEEP_INTERVAL_MS,
        });
        this.timer = setInterval(() => void this.sweep(), FULFILMENT_SWEEP_INTERVAL_MS);
        void this.sweep();
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async sweep(): Promise<void> {
        if (this.sweeping) {
            this.logger.debug('the previous reveal sweep is still running, skipping this tick');
            return;
        }
        if (!this.wallet.isReady()) {
            this.logger.debug('no wallet yet, so there is no owner to sweep reveal requests for');
            return;
        }

        this.sweeping = true;
        try {
            const owner = this.wallet.get().getAddress();
            const view = await this.revealRequests.listOpenRequests(owner);
            if (view.requests.length === 0) {
                return;
            }

            const strategy = await this.randomness.resolve();
            if (strategy === null) {
                return;
            }

            for (const request of view.requests) {
                const row = toOpenRequestRow(request);
                if (row === null) {
                    continue;
                }
                await this.settle(strategy, row);
            }
        } catch (error) {
            this.logger.warn('the background reveal sweep could not get through this tick', {
                error: errorMessage(error),
            });
        } finally {
            this.sweeping = false;
        }
    }

    private async settle(strategy: SelfServiceRandomness, row: OpenRequestRow): Promise<void> {
        if (!sameAddress(row.source, strategy.source)) {
            this.logger.debug('leaving a reveal request opened at a retired randomness source alone', {
                requestId: row.requestId.toString(),
                tokenId: row.tokenId,
                source: row.source,
                current: strategy.source,
            });
            return;
        }

        const key = fulfilmentKey(row.source, row.requestId);
        const waiting = this.backoff.get(key);
        if (waiting !== undefined && Date.now() < waiting.nextAttemptAt) {
            return;
        }
        if (!this.claims.claim(row.source, row.requestId)) {
            this.logger.debug('another caller is already settling this reveal request', {
                requestId: row.requestId.toString(),
                tokenId: row.tokenId,
            });
            return;
        }

        try {
            const view = await strategy.readRequest(row.requestId);
            if (view.state === AdapterRequestState.CLOSED) {
                this.backoff.delete(key);
                return;
            }

            const answer = await strategy.beacon.signatureOf(view.round);
            if (answer.outcome !== BeaconRoundOutcome.SIGNED) {
                this.defer(key, row, answer.reason);
                return;
            }

            const sent = await strategy.fulfill({
                requestId: row.requestId,
                round: view.round,
                signature: answer.signature,
            });
            if (sent.state === AdapterRequestState.CLOSED) {
                this.backoff.delete(key);
                return;
            }

            const confirmed = await this.contracts.confirm(sent.txHash, FULFILMENT_REVERT_LABEL);
            this.backoff.delete(key);
            this.logger.info('settled an open reveal request in the background', {
                requestId: row.requestId.toString(),
                tokenId: row.tokenId,
                round: view.round.toString(),
                txHash: confirmed.txHash,
            });
        } catch (error) {
            this.defer(key, row, errorMessage(error));
        } finally {
            this.claims.release(row.source, row.requestId);
        }
    }

    private defer(key: string, row: OpenRequestRow, reason: string): void {
        const failures = (this.backoff.get(key)?.failures ?? 0) + 1;
        const delayMs = backoffDelayMs(failures);
        this.backoff.set(key, { failures, nextAttemptAt: Date.now() + delayMs });
        this.logger.warn('a background reveal fulfilment did not go through', {
            requestId: row.requestId.toString(),
            tokenId: row.tokenId,
            failures,
            retryInMs: delayMs,
            reason,
        });
    }
}
