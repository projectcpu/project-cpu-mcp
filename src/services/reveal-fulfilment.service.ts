import { getAddress, isAddress, type Hash } from 'viem';

import {
    type FulfillRevealInput,
    type IAppConfig,
    type RevealFulfilmentEntry,
    RevealFulfilmentOutcome,
    type RevealFulfilmentReport,
    type RevealFulfilmentServiceOptions,
    type RevealFulfilmentTarget,
    type SelfServiceRevealRequests,
} from './types.js';
import type { IRevealRequestsReader } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { FULFILMENT_REVERT_LABEL } from '../randomness/constants.js';
import { parseRequestId, sameAddress, sameTokenId, toOpenRequestRow } from '../randomness/request.utils.js';
import {
    AdapterRequestState,
    type BeaconRoundMalformed,
    type BeaconRoundNotReleased,
    BeaconRoundOutcome,
    type IFulfilmentClaims,
    type ISelfServiceRandomnessResolver,
    type SelfServiceRandomness,
} from '../randomness/types.js';
import { errorMessage } from '../utils/error.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class RevealFulfilmentService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly randomness: ISelfServiceRandomnessResolver;
    private readonly revealRequests: IRevealRequestsReader;
    private readonly contracts: IContractClient;
    private readonly claims: IFulfilmentClaims;
    private readonly logger: ILogger;

    constructor(options: RevealFulfilmentServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.randomness = options.randomness;
        this.revealRequests = options.revealRequests;
        this.contracts = options.contracts;
        this.claims = options.claims;
        this.logger = options.logger;
    }

    async openRequests(owner: string): Promise<SelfServiceRevealRequests | null> {
        const strategy = await this.randomness.resolve();
        if (strategy === null) {
            return null;
        }

        const view = await this.revealRequests.listOpenRequests(owner);
        this.logger.debug('read the open reveal requests behind the attention list', {
            owner,
            source: strategy.source,
            open: view.requests.length,
        });
        return { currentSource: strategy.source, serverTime: view.serverTime, requests: view.requests };
    }

    async fulfill(input: FulfillRevealInput): Promise<RevealFulfilmentReport> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();

        if (config.chainId !== wallet.getChainId()) {
            throw new Error(
                `Chain mismatch: the chain config is chainId ${config.chainId} but the wallet is on ${wallet.getChainId()}. Check NETWORK.`,
            );
        }

        const strategy = await this.randomness.resolve();
        if (strategy === null) {
            throw new Error(
                `Reveals on network ${config.network} are delivered by the randomness source itself, so there ` +
                    `is nothing here for you to settle by hand. Request a reveal with reveal and read the draw ` +
                    `with get_cell once it lands.`,
            );
        }

        const owner = wallet.getAddress();
        const targets = await this.targetsOf(input, owner, strategy);
        this.logger.info('settling open reveal requests on request', {
            owner,
            source: strategy.source,
            targets: targets.length,
        });

        const requests: Array<RevealFulfilmentEntry> = [];
        for (const target of targets) {
            requests.push(await this.settle(strategy, target));
        }
        return { owner, source: strategy.source, requests };
    }

    private async targetsOf(
        input: FulfillRevealInput,
        owner: string,
        strategy: SelfServiceRandomness,
    ): Promise<Array<RevealFulfilmentTarget>> {
        if (input.requestId !== null || input.source !== null) {
            return [this.namedTarget(input)];
        }

        const named = input.tokenIds !== null && input.tokenIds.length > 0 ? input.tokenIds : null;
        const view = await this.revealRequests.listOpenRequests(owner);
        const targets: Array<RevealFulfilmentTarget> = [];
        for (const request of view.requests) {
            const row = toOpenRequestRow(request);
            if (row === null) {
                this.logger.warn('the game API listed an open reveal request this client cannot read', {
                    requestId: request.requestId,
                    source: request.source,
                    tokenId: request.tokenId,
                });
                continue;
            }
            if (named !== null && !named.some((tokenId) => sameTokenId(tokenId, row.tokenId))) {
                continue;
            }
            targets.push({ requestId: row.requestId, source: row.source, tokenId: row.tokenId });
        }

        this.logger.debug('picked the reveal requests to settle', {
            source: strategy.source,
            open: view.requests.length,
            picked: targets.length,
        });
        return targets;
    }

    private namedTarget(input: FulfillRevealInput): RevealFulfilmentTarget {
        if (input.requestId === null || input.source === null) {
            throw new Error(
                'Settling a reveal request the game API does not list takes both halves of the pair: the ' +
                    'request id and the address of the randomness source it was opened at. Pass them together.',
            );
        }
        if (input.tokenIds !== null && input.tokenIds.length > 0) {
            throw new Error(
                'Name either the cells to settle or one request by id and source, not both: a request named ' +
                    'by id is settled without asking the game API which cell it belongs to.',
            );
        }

        const requestId = parseRequestId(input.requestId);
        if (requestId === null) {
            throw new Error(
                `Reveal request id "${input.requestId}" is not a whole number — pass the id exactly as the ` +
                    `reveal that opened it reported it.`,
            );
        }
        if (!isAddress(input.source, { strict: false })) {
            throw new Error(
                `"${input.source}" is not an address — pass the randomness source the reveal that opened the ` +
                    `request reported.`,
            );
        }
        return { requestId, source: getAddress(input.source), tokenId: null };
    }

    private async settle(
        strategy: SelfServiceRandomness,
        target: RevealFulfilmentTarget,
    ): Promise<RevealFulfilmentEntry> {
        if (!sameAddress(target.source, strategy.source)) {
            return this.entry(
                target,
                RevealFulfilmentOutcome.RetiredSource,
                null,
                null,
                `This request was opened at randomness source ${target.source}, while the chain config now ` +
                    `reveals through ${strategy.source}. A cell takes its draw only from the source its own ` +
                    `request names, so a fulfilment sent through the current one would revert; nothing was sent.`,
            );
        }
        if (!this.claims.claim(target.source, target.requestId)) {
            return this.entry(
                target,
                RevealFulfilmentOutcome.Busy,
                null,
                null,
                `This client is already settling this request, so this call sent no fulfilment of its own. ` +
                    this.readBack(target),
            );
        }

        let round: bigint | null = null;
        try {
            const view = await strategy.readRequest(target.requestId);
            if (view.state === AdapterRequestState.CLOSED) {
                return this.entry(
                    target,
                    RevealFulfilmentOutcome.AlreadyDone,
                    null,
                    null,
                    `The randomness source no longer holds this request — it is already settled. ` +
                        this.readBack(target),
                );
            }
            round = view.round;

            const answer = await strategy.beacon.signatureOf(round);
            if (answer.outcome !== BeaconRoundOutcome.SIGNED) {
                return this.entry(target, RevealFulfilmentOutcome.NotReady, round, null, this.beaconReason(answer));
            }

            const sent = await strategy.fulfill({ requestId: target.requestId, round, signature: answer.signature });
            if (sent.state === AdapterRequestState.CLOSED) {
                return this.entry(
                    target,
                    RevealFulfilmentOutcome.AlreadyDone,
                    round,
                    null,
                    `${sent.reason} ${this.readBack(target)}`,
                );
            }

            const confirmed = await this.contracts.confirm(sent.txHash, FULFILMENT_REVERT_LABEL);
            this.logger.info('settled an open reveal request', {
                requestId: target.requestId.toString(),
                tokenId: target.tokenId,
                round: round.toString(),
                txHash: confirmed.txHash,
            });
            return this.entry(
                target,
                RevealFulfilmentOutcome.Settled,
                round,
                confirmed.txHash,
                `The draw of round ${round} is delivered on-chain. ${this.readBack(target)}`,
            );
        } catch (error) {
            this.logger.warn('a reveal fulfilment did not go through', {
                requestId: target.requestId.toString(),
                tokenId: target.tokenId,
                round: round?.toString() ?? null,
                error: errorMessage(error),
            });
            return this.entry(target, RevealFulfilmentOutcome.Failed, round, null, errorMessage(error));
        } finally {
            this.claims.release(target.source, target.requestId);
        }
    }

    private beaconReason(answer: BeaconRoundNotReleased | BeaconRoundMalformed): string {
        const round = answer.round.toString();
        if (answer.outcome === BeaconRoundOutcome.MALFORMED) {
            return `The beacon answered for round ${round} in a shape this client cannot fulfil with (${answer.reason}).`;
        }
        return (
            `Round ${round} is not published yet (${answer.reason}), so there is no draw to deliver. The ` +
            `request stays open — call fulfill_reveal again in a few seconds.`
        );
    }

    private readBack(target: RevealFulfilmentTarget): string {
        return target.tokenId === null
            ? 'Read the draw with get_cell on the cell that opened it.'
            : `Read the draw with get_cell ${target.tokenId}.`;
    }

    private entry(
        target: RevealFulfilmentTarget,
        outcome: RevealFulfilmentOutcome,
        round: bigint | null,
        fulfillTxHash: Hash | null,
        note: string,
    ): RevealFulfilmentEntry {
        return {
            requestId: target.requestId.toString(),
            source: target.source,
            tokenId: target.tokenId,
            outcome,
            round: round === null ? null : round.toString(),
            fulfillTxHash,
            note,
        };
    }
}
