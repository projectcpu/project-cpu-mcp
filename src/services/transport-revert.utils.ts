import { decodeKnownRevert } from './revert-decode.utils.js';
import { type QuoteRouteParams, TransportRevertName } from './types.js';
import { TRANSPORT_ABI } from '../contracts/transport.abi.js';

const TRANSPORT_QUOTE_REVERT_NAMES: ReadonlyArray<TransportRevertName> = [TransportRevertName.STORAGE_FULL];

export function withTransportQuotePhrase(error: unknown, params: QuoteRouteParams): unknown {
    const decoded = decodeKnownRevert(error, TRANSPORT_ABI, TRANSPORT_QUOTE_REVERT_NAMES);
    if (decoded?.name !== TransportRevertName.STORAGE_FULL) {
        return error;
    }
    const destination = params.tokenIds.at(-1)?.toString() ?? 'unknown';
    return new Error(
        `Route cannot be quoted: destination cell ${destination} has no room for ${params.amount.toString()} ` +
            `units of resource ${params.res}, with liquid, reserved, and pending production all counted. Nothing ` +
            `was approved or sent — free space there or choose another destination, then quote again.`,
        { cause: error },
    );
}
