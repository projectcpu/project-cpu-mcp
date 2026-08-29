import { isAddress, type Address, type Hash } from 'viem';

import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import { isRevealAlreadyPending } from './reveal-revert.utils.js';
import {
    REVEAL_POLL_INTERVAL_MS,
    REVEAL_POLL_TIMEOUT_MS,
    REVEAL_PRIME_ATTEMPTS,
    REVEAL_PRIME_INTERVAL_MS,
} from './reveal.constants.js';
import { bufferedRevealValue, revealCpuShortfallMessage, revealDepositsOf, revealRequestedOf } from './reveal.utils.js';
import {
    type AppConfig,
    type FundedRevealRequest,
    type IAllowanceService,
    type IAppConfig,
    type ICellClient,
    type PushRevealInput,
    type RevealDepositView,
    type RevealQuote,
    type RevealRequestContext,
    type RevealResult,
    type RevealServiceOptions,
    RevealSettlementKind,
    type RevealSettlementOutcome,
    type SelfServiceRevealInput,
} from './types.js';
import { RandomnessKind } from '../api/types.js';
import { ERC20_ABI } from '../contracts/erc20.abi.js';
import type { ILogger } from '../logger/types.js';
import type { Cell, RevealCellReader } from '../map/types.js';
import { sameAddress } from '../randomness/request.utils.js';
import { planBeaconWait } from '../randomness/round.utils.js';
import {
    AdapterRequestState,
    type BeaconRoundMalformed,
    type BeaconRoundNotReleased,
    BeaconRoundOutcome,
    type BeaconRoundResult,
    type IFulfilmentClaims,
    type IRandomnessStrategyFactory,
    type OpenRequestMatch,
} from '../randomness/types.js';
import { sleep } from '../utils/async.utils.js';
import { errorMessage } from '../utils/error.utils.js';
import { cpuFromWei, ethFromWei } from '../utils/format.utils.js';
import type { ConfirmedTx, IContractClient, WalletManager, WalletProvider } from '../wallet/types.js';

export class RevealService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly allowance: IAllowanceService;
    private readonly cellClient: ICellClient;
    private readonly contracts: IContractClient;
    private readonly randomness: IRandomnessStrategyFactory;
    private readonly claims: IFulfilmentClaims;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;

    constructor(options: RevealServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.allowance = options.allowance;
        this.cellClient = options.cellClient;
        this.contracts = options.contracts;
        this.randomness = options.randomness;
        this.claims = options.claims;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
    }

    async reveal(tokenId: string): Promise<RevealResult> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const { config, wallet } = action;
        const cell = action.requireContract(AppContract.Cell, 'cannot reveal');

        const state = await this.mapReader.readRevealCell(tokenId);
        if (state === null) {
            throw new Error(`Cell ${tokenId} is not in the current map; cannot verify ownership before reveal.`);
        }

        const address = wallet.getAddress();
        if (!sameAddress(state.owner, address)) {
            throw new Error(`You do not own cell ${tokenId} (owner ${state.owner}); only the owner can reveal it.`);
        }

        const genesis = state.revealCount === 0;
        const randomness = await this.randomness.create(config.randomness, cell);
        const kind = randomness.kind;

        switch (randomness.kind) {
            case RandomnessKind.ENTROPY:
                return this.revealThroughPushSource({
                    randomness,
                    config,
                    cell,
                    tokenId,
                    genesis,
                    previousRevealCount: state.revealCount,
                });
            case RandomnessKind.DRAND:
                return this.revealThroughSelfServiceSource({
                    randomness,
                    config,
                    cell,
                    tokenId,
                    genesis,
                    previousRevealCount: state.revealCount,
                    pending: state.revealPending,
                    owner: address,
                });
            default: {
                const _unsupported: never = randomness;
                throw new Error(
                    `This client build has no reveal path for the randomness strategy the chain config ` +
                        `selected: ${kind}.`,
                );
            }
        }
    }

    private async revealThroughPushSource(input: PushRevealInput): Promise<RevealResult> {
        const { randomness, cell, tokenId, genesis, previousRevealCount } = input;
        const { approveTxHash, quote, value } = await this.prepareRevealRequest(input);
        const confirmed = await this.sendRevealRequest(cell, tokenId, value);

        const fulfilled = await this.pollFulfillment(tokenId, previousRevealCount);

        this.logger.info('reveal request confirmed', {
            tokenId,
            txHash: confirmed.txHash,
            block: confirmed.blockNumber,
            fulfilled,
        });

        return {
            tokenId,
            genesis,
            requestTxHash: confirmed.txHash,
            fulfillTxHash: null,
            requestId: null,
            source: randomness.source,
            round: null,
            deposits: null,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
            ethPaid: ethFromWei(quote.ethBudgetWei.toString()),
            cpuBurn: cpuFromWei(quote.cpuBurnWei.toString()),
            approveTxHash,
            fulfilled,
            note: null,
        };
    }

    private async revealThroughSelfServiceSource(input: SelfServiceRevealInput): Promise<RevealResult> {
        const { randomness, cell, tokenId } = input;

        if (input.pending) {
            return this.settleOpenRequest(input, null);
        }

        const { approveTxHash, quote, value } = await this.prepareRevealRequest(input);

        let confirmed: ConfirmedTx;
        try {
            confirmed = await this.sendRevealRequest(cell, tokenId, value);
        } catch (error) {
            if (!isRevealAlreadyPending(error)) {
                throw error;
            }
            this.logger.info('the cell carries a reveal request the map had not caught up with yet', {
                tokenId,
                cell,
            });
            return this.settleOpenRequest(input, approveTxHash);
        }
        const requested = revealRequestedOf(confirmed.logs, cell, tokenId);

        this.logger.info('reveal request confirmed', {
            tokenId,
            txHash: confirmed.txHash,
            block: confirmed.blockNumber,
            requestId: requested?.requestId.toString() ?? null,
            source: requested?.source ?? null,
        });

        return this.settleRequest(input, {
            requestId: requested?.requestId ?? null,
            source: requested?.source ?? randomness.source,
            requestTxHash: confirmed.txHash,
            approveTxHash,
            paidWei: quote.ethBudgetWei,
            cpuBurnWei: quote.cpuBurnWei,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        });
    }

    private async settleOpenRequest(input: SelfServiceRevealInput, approveTxHash: Hash | null): Promise<RevealResult> {
        const open = await input.randomness.findOpenRequest(input.owner, input.tokenId);
        if (open === null) {
            return this.pendingWithoutSettleableRequest(input, approveTxHash);
        }
        this.logger.info('settling the reveal request the cell already carries', {
            tokenId: input.tokenId,
            requestId: open.requestId.toString(),
            source: open.source,
        });
        return this.settleRequest(input, {
            requestId: open.requestId,
            source: open.source,
            requestTxHash: null,
            approveTxHash,
            paidWei: 0n,
            cpuBurnWei: 0n,
            status: null,
            blockNumber: null,
        });
    }

    private async settleRequest(input: SelfServiceRevealInput, ctx: RevealRequestContext): Promise<RevealResult> {
        const { randomness, cell, tokenId } = input;
        const requestId = ctx.requestId;

        if (requestId === null) {
            return this.unfinished(
                input,
                ctx,
                null,
                `The reveal request went through, but this client could not read its id back out of the ` +
                    `receipt, so it has nothing to settle with.`,
            );
        }
        if (!sameAddress(ctx.source, randomness.source)) {
            return this.unfinished(
                input,
                ctx,
                null,
                `Cell ${tokenId} opened reveal request ${requestId} at randomness source ${ctx.source}, while ` +
                    `the chain config points this client at ${randomness.source}, so this call cannot settle it.`,
            );
        }

        if (!this.claims.claim(ctx.source, requestId)) {
            return this.unfinished(
                input,
                ctx,
                null,
                `Reveal request ${requestId} for cell ${tokenId} is already being settled by this client, so ` +
                    `this call sent no fulfilment of its own.`,
            );
        }

        let outcome: RevealSettlementOutcome;
        try {
            outcome = await this.driveSettlement(input, requestId);
        } finally {
            this.claims.release(ctx.source, requestId);
        }

        if (outcome.kind === RevealSettlementKind.Unfinished) {
            return this.unfinished(input, ctx, outcome.round, outcome.reason);
        }

        const deposits = revealDepositsOf(outcome.logs, cell, requestId, input.config.resources);
        if (outcome.fulfillTxHash !== null) {
            this.logger.info('reveal fulfilment confirmed', {
                tokenId,
                requestId: requestId.toString(),
                round: outcome.round?.toString() ?? null,
                txHash: outcome.fulfillTxHash,
                drawn: deposits?.length ?? null,
            });
        }
        const stale = await this.primeSettled(input);
        return this.settled(input, ctx, outcome.round, outcome.fulfillTxHash, deposits, stale);
    }

    private async driveSettlement(input: SelfServiceRevealInput, requestId: bigint): Promise<RevealSettlementOutcome> {
        const { randomness, cell, tokenId } = input;
        let round: bigint | null = null;
        try {
            const view = await randomness.readRequest(requestId);
            if (view.state === AdapterRequestState.CLOSED) {
                this.logger.info('the reveal request was settled before this call reached the source', {
                    tokenId,
                    requestId: requestId.toString(),
                });
                return { kind: RevealSettlementKind.Settled, round: null, fulfillTxHash: null, logs: [] };
            }
            if (!sameAddress(view.consumer, cell)) {
                return {
                    kind: RevealSettlementKind.Unfinished,
                    round: view.round,
                    reason:
                        `Reveal request ${requestId} at ${randomness.source} is held for ${view.consumer}, not for ` +
                        `the cell contract ${cell} this client reveals through, so this call will not settle it.`,
                };
            }

            round = view.round;
            const answer = await this.askBeaconFor(input, round);
            if (answer.outcome !== BeaconRoundOutcome.SIGNED) {
                return { kind: RevealSettlementKind.Unfinished, round, reason: this.beaconReason(answer) };
            }

            const fulfilment = await randomness.fulfill({ requestId, round, signature: answer.signature });
            if (fulfilment.state === AdapterRequestState.CLOSED) {
                return { kind: RevealSettlementKind.Settled, round, fulfillTxHash: null, logs: [] };
            }

            const confirmed = await this.contracts.confirm(fulfilment.txHash, 'Reveal fulfilment');
            return {
                kind: RevealSettlementKind.Settled,
                round,
                fulfillTxHash: confirmed.txHash,
                logs: confirmed.logs,
            };
        } catch (error) {
            this.logger.error('the reveal request went out but the cycle did not finish', {
                tokenId,
                requestId: requestId.toString(),
                round: round?.toString() ?? null,
                error,
            });
            return { kind: RevealSettlementKind.Unfinished, round, reason: errorMessage(error) };
        }
    }

    private async askBeaconFor(input: SelfServiceRevealInput, round: bigint): Promise<BeaconRoundResult> {
        const plan = planBeaconWait(input.randomness.clock, round, this.mapReader.getServerTime());
        this.logger.info('waiting for the beacon to publish the round that settles the reveal', {
            tokenId: input.tokenId,
            round: round.toString(),
            releaseAt: plan.releaseAt,
            budgetMs: plan.budgetMs,
            retryDelayMs: plan.retryDelayMs,
        });

        const deadline = Date.now() + plan.budgetMs;
        let answer = await input.randomness.beacon.signatureOf(round);
        while (answer.outcome === BeaconRoundOutcome.NOT_RELEASED && Date.now() + plan.retryDelayMs <= deadline) {
            await sleep(plan.retryDelayMs);
            answer = await input.randomness.beacon.signatureOf(round);
        }
        return answer;
    }

    private beaconReason(answer: BeaconRoundNotReleased | BeaconRoundMalformed): string {
        const round = answer.round.toString();
        if (answer.outcome === BeaconRoundOutcome.MALFORMED) {
            return `The beacon answered for round ${round} in a shape this client cannot fulfil with (${answer.reason}).`;
        }
        return `Round ${round} was still unpublished when the wait this call budgets ran out (${answer.reason}).`;
    }

    private async primeSettled(input: SelfServiceRevealInput): Promise<string | null> {
        const failure = await this.primeMap(
            input.tokenId,
            (state) => state.revealCount > input.previousRevealCount,
            'the map did not take the settled reveal',
        );
        if (failure === null) {
            return null;
        }
        return (
            `The reveal is settled on-chain, but refreshing the map right after it failed (${failure}), so ` +
            `get_cell ${input.tokenId} may still show the cell without the new draw until the map catches up.`
        );
    }

    private async primeOpen(input: SelfServiceRevealInput): Promise<void> {
        await this.primeMap(
            input.tokenId,
            (state) => state.revealPending,
            'the map did not take the open reveal request',
        );
    }

    private async primeMap(
        tokenId: string,
        taken: (state: Cell) => boolean,
        failureLog: string,
    ): Promise<string | null> {
        let failure: string | null = null;
        for (let attempt = 1; attempt <= REVEAL_PRIME_ATTEMPTS; attempt += 1) {
            try {
                await this.mapReader.refresh();
                const state = await this.mapReader.readRevealCell(tokenId);
                if (state !== null && taken(state)) {
                    return null;
                }
                failure = null;
            } catch (error) {
                this.logger.warn(failureLog, { tokenId, attempt, error });
                failure = errorMessage(error);
            }
            if (attempt < REVEAL_PRIME_ATTEMPTS) {
                await sleep(REVEAL_PRIME_INTERVAL_MS);
            }
        }
        return failure;
    }

    private settled(
        input: SelfServiceRevealInput,
        ctx: RevealRequestContext,
        round: bigint | null,
        fulfillTxHash: Hash | null,
        deposits: Array<RevealDepositView> | null,
        note: string | null,
    ): RevealResult {
        return {
            ...this.resultBase(input, ctx, round),
            fulfillTxHash,
            deposits,
            fulfilled: true,
            note,
        };
    }

    private async unfinished(
        input: SelfServiceRevealInput,
        ctx: RevealRequestContext,
        round: bigint | null,
        reason: string,
    ): Promise<RevealResult> {
        await this.primeOpen(input);
        return {
            ...this.resultBase(input, ctx, round),
            fulfillTxHash: null,
            deposits: null,
            fulfilled: false,
            note:
                `${reason} The reveal request stays open: call reveal on cell ${input.tokenId} again to settle ` +
                `it — that pays for no second reveal — or read the draw with get_cell ${input.tokenId} once anyone ` +
                `settles it.`,
        };
    }

    private resultBase(
        input: SelfServiceRevealInput,
        ctx: RevealRequestContext,
        round: bigint | null,
    ): Omit<RevealResult, 'fulfillTxHash' | 'deposits' | 'fulfilled' | 'note'> {
        return {
            tokenId: input.tokenId,
            genesis: input.genesis,
            requestTxHash: ctx.requestTxHash,
            requestId: ctx.requestId === null ? null : ctx.requestId.toString(),
            source: ctx.source,
            round: round === null ? null : round.toString(),
            status: ctx.status,
            blockNumber: ctx.blockNumber,
            ethPaid: ethFromWei(ctx.paidWei.toString()),
            cpuBurn: cpuFromWei(ctx.cpuBurnWei.toString()),
            approveTxHash: ctx.approveTxHash,
        };
    }

    private async pendingWithoutSettleableRequest(
        input: SelfServiceRevealInput,
        approveTxHash: Hash | null,
    ): Promise<RevealResult> {
        const retired = await input.randomness.findRetiredSourceRequest(input.owner, input.tokenId);
        return retired === null
            ? this.pendingButUnlisted(input, approveTxHash)
            : this.pendingAtRetiredSource(input, retired, approveTxHash);
    }

    private pendingAtRetiredSource(
        input: SelfServiceRevealInput,
        retired: OpenRequestMatch,
        approveTxHash: Hash | null,
    ): RevealResult {
        this.logger.warn('the cell is locked on a reveal request opened at a randomness source it has replaced', {
            tokenId: input.tokenId,
            requestId: retired.requestId.toString(),
            retiredSource: retired.source,
            source: input.randomness.source,
        });
        const ctx: RevealRequestContext = {
            requestId: retired.requestId,
            source: retired.source,
            requestTxHash: null,
            approveTxHash,
            paidWei: 0n,
            cpuBurnWei: 0n,
            status: null,
            blockNumber: null,
        };
        return {
            ...this.resultBase(input, ctx, null),
            fulfillTxHash: null,
            deposits: null,
            fulfilled: false,
            note:
                `Cell ${input.tokenId} carries reveal request ${retired.requestId}, opened at randomness source ` +
                `${retired.source}, while the chain config now reveals through ${input.randomness.source}. A cell ` +
                `takes its draw only from the source its own request names, so nothing you can send closes this ` +
                `one: this call requested nothing and paid nothing, calling reveal again will not clear the ` +
                `cell, and fulfill_reveal refuses a request of a retired source. The cell stays locked on this ` +
                `open request until an admin of the contracts clears it on-chain — that admin cleanup is the only ` +
                `way out.`,
        };
    }

    private pendingButUnlisted(input: SelfServiceRevealInput, approveTxHash: Hash | null): RevealResult {
        this.logger.warn('the cell carries a reveal request the game API does not list yet', {
            tokenId: input.tokenId,
            source: input.randomness.source,
        });
        return {
            tokenId: input.tokenId,
            genesis: input.genesis,
            requestTxHash: null,
            fulfillTxHash: null,
            requestId: null,
            source: input.randomness.source,
            round: null,
            deposits: null,
            status: null,
            blockNumber: null,
            ethPaid: '0',
            cpuBurn: '0',
            approveTxHash,
            fulfilled: false,
            note:
                `Cell ${input.tokenId} already carries a reveal request, so this call requested nothing and ` +
                `paid nothing, but the game API does not list that request yet, so this call cannot tell ` +
                `which request to settle. Two ways out: call reveal on cell ${input.tokenId} again in a few ` +
                `seconds and it settles the request once the API lists it; or leave it — anyone holding the ` +
                `beacon signature can settle it — and read the draw with get_cell ${input.tokenId} once it lands.`,
        };
    }

    /**
     * Every reveal is paid for, first one included, and only the Cell knows the price: the served config omits
     * live service-fee split and validates that it fits inside the configured ETH budget. A zero burn needs no
     * approval; service fees can consume the whole ETH budget without making the reveal free.
     */
    private async fundReveal(
        config: AppConfig,
        cell: Address,
        tokenId: string,
    ): Promise<{ approveTxHash: Hash | null; quote: RevealQuote }> {
        const quote = await this.cellClient.quoteReveal(cell);
        if (quote.cpuBurnWei === 0n) {
            return { approveTxHash: null, quote };
        }
        const cpuToken = config.contracts.cpuToken;
        if (!isAddress(cpuToken, { strict: false })) {
            throw new Error(`$CPU token is not configured for network ${config.network}; cannot pay for a reveal.`);
        }
        const cpuBalanceWei = await this.readCpuBalance(this.wallet.get(), cpuToken);
        if (cpuBalanceWei !== null && cpuBalanceWei < quote.cpuBurnWei) {
            throw new Error(revealCpuShortfallMessage(tokenId, quote, cpuBalanceWei));
        }
        const approveTxHash = await this.allowance.ensureAllowance(cpuToken, cell, quote.cpuBurnWei);
        return { approveTxHash, quote };
    }

    private async readCpuBalance(wallet: WalletManager, cpuToken: Address): Promise<bigint | null> {
        try {
            const balance = await wallet.readContract({
                address: cpuToken,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [wallet.getAddress()],
            });
            if (typeof balance !== 'bigint') {
                throw new Error(`balanceOf returned ${typeof balance}`);
            }
            return balance;
        } catch (error) {
            this.logger.warn('could not preflight reveal $CPU balance; continuing with on-chain validation', {
                error: errorMessage(error),
            });
            return null;
        }
    }

    private async prepareRevealRequest(input: PushRevealInput | SelfServiceRevealInput): Promise<FundedRevealRequest> {
        const { randomness, config, cell, tokenId, genesis } = input;
        const { approveTxHash, quote } = await this.fundReveal(config, cell, tokenId);
        const value = bufferedRevealValue(quote.ethBudgetWei);

        this.logger.info('requesting on-chain reveal', {
            tokenId,
            cell,
            genesis,
            source: randomness.source,
            quotedWei: quote.ethBudgetWei.toString(),
            valueWei: value.toString(),
            cpuBurnWei: quote.cpuBurnWei.toString(),
            network: config.network,
        });

        return { approveTxHash, quote, value };
    }

    private async sendRevealRequest(cell: Address, tokenId: string, value: bigint): Promise<ConfirmedTx> {
        const txHash = await this.cellClient.requestReveal({ cell, tokenId: BigInt(tokenId), value });
        return this.contracts.confirm(txHash, 'Reveal request');
    }

    private async pollFulfillment(tokenId: string, previousRevealCount: number): Promise<boolean> {
        const deadline = Date.now() + REVEAL_POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await sleep(REVEAL_POLL_INTERVAL_MS);
            await this.mapReader.refresh();
            const state = await this.mapReader.readRevealCell(tokenId);
            if (state !== null && state.revealCount > previousRevealCount) {
                return true;
            }
        }
        return false;
    }
}
