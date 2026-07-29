import { toContractSignature } from './beacon.utils.js';
import { BEACON_RETRY_INTERVAL_MS, BEACON_ROUND_PATH, BEACON_SIGNATURE_BYTES } from './constants.js';
import {
    type BeaconClientOptions,
    BeaconRoundOutcome,
    type BeaconRoundResult,
    beaconRoundSchema,
    type IBeaconClient,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';

export class BeaconClient implements IBeaconClient {
    private readonly baseUrl: string;
    private readonly logger: ILogger;

    constructor(options: BeaconClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.logger = options.logger;
    }

    async signatureOf(round: bigint): Promise<BeaconRoundResult> {
        const url = `${this.baseUrl}${BEACON_ROUND_PATH}${round}`;
        this.logger.debug('asking the beacon for a round signature', { url });

        let response: Response;
        try {
            response = await fetch(url, { signal: AbortSignal.timeout(BEACON_RETRY_INTERVAL_MS) });
        } catch (error) {
            return this.notReleased(round, `the beacon at ${this.baseUrl} did not answer (${errorMessage(error)})`);
        }

        if (!response.ok) {
            return this.notReleased(round, `the beacon answered ${response.status} for round ${round}`);
        }

        let body: unknown;
        try {
            body = await response.json();
        } catch (error) {
            return this.notReleased(round, `the beacon answered with a body that is not JSON (${errorMessage(error)})`);
        }

        const parsed = beaconRoundSchema.safeParse(body);
        if (!parsed.success) {
            return this.notReleased(round, 'the beacon answered without a round number and a signature');
        }

        if (BigInt(parsed.data.round) !== round) {
            return this.notReleased(round, `the beacon answered with round ${parsed.data.round} instead`);
        }

        const signature = toContractSignature(parsed.data.signature);
        if (signature === null) {
            return this.malformed(
                round,
                `the beacon signs rounds in a scheme this client cannot fulfil with — ` +
                    `expected ${BEACON_SIGNATURE_BYTES} bytes of hex, got ${parsed.data.signature.length} characters`,
            );
        }

        this.logger.debug('got a round signature from the beacon', { round: round.toString() });
        return { outcome: BeaconRoundOutcome.SIGNED, round, signature };
    }

    private notReleased(round: bigint, reason: string): BeaconRoundResult {
        this.logger.debug('the beacon has not released the round yet', { round: round.toString(), reason });
        return { outcome: BeaconRoundOutcome.NOT_RELEASED, round, reason };
    }

    private malformed(round: bigint, reason: string): BeaconRoundResult {
        this.logger.warn('the beacon answered in a shape this client cannot use', { round: round.toString(), reason });
        return { outcome: BeaconRoundOutcome.MALFORMED, round, reason };
    }
}
