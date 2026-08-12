import { decodeKnownRevert } from './revert-decode.utils.js';
import { CellRevertName } from './types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import { withAdapterPhrase } from '../randomness/adapter-revert.utils.js';

const CELL_REVERT_NAMES: ReadonlyArray<CellRevertName> = Object.values(CellRevertName);

function messageFor(name: CellRevertName, args: ReadonlyArray<unknown>, tokenId: string): string {
    switch (name) {
        case CellRevertName.INSUFFICIENT_REVEAL_FEE:
            return (
                `The reveal fee moved between the quote and the send: the cell asks the randomness source for ` +
                `its fee inside the request, and this transaction carried less than it quoted. The quote ` +
                `follows the gas price, so quote again and retry.`
            );
        case CellRevertName.REVEAL_NOT_CONFIGURED:
            return (
                `This deployment has no reveal draw configured, so no cell can be revealed on it yet. Nothing ` +
                `was spent and cell ${tokenId} is untouched.`
            );
        case CellRevertName.REVEAL_CELL_OCCUPIED:
            return (
                `Cell ${tokenId} has a building on it and a reveal needs an empty cell. Demolish the building ` +
                `first, then reveal.`
            );
        case CellRevertName.REVEAL_PROCESS_ACTIVE:
            return (
                `Cell ${tokenId} is running a mining or craft process and a reveal needs an idle cell. Claim ` +
                `and finish it first, then reveal.`
            );
        case CellRevertName.REVEAL_ALREADY_PENDING:
            return (
                `Cell ${tokenId} already has a reveal request waiting for its draw, so a second request is ` +
                `refused and no reveal fee was paid. Where the randomness source delivers the draw itself, that ` +
                `open request settles on its own — read the draw with get_cell ${tokenId}. Where delivery is ` +
                `left to you, call reveal on cell ${tokenId} again to settle the open request instead of ` +
                `opening another, or fulfill_reveal to see what is blocking it. get_game_config names which of ` +
                `the two this network runs.`
            );
        case CellRevertName.REVEAL_IN_FLIGHT:
            return (
                `Cell ${tokenId} carries an open reveal request, and nothing can be built on a cell while one ` +
                `is open, so no building went up. The cell frees up once the draw lands: where the randomness ` +
                `source delivers the draw itself that happens on its own, and where delivery is left to you, ` +
                `reveal on cell ${tokenId} or fulfill_reveal settles the open request. get_game_config names ` +
                `which of the two this network runs, and get_cell ${tokenId} shows the cell once it is clear.`
            );
        case CellRevertName.DEPOSITS_NOT_EXHAUSTED:
            return (
                `Cell ${tokenId} still holds deposits, and a re-reveal only opens once every deposit on it is ` +
                `mined out. Mine it dry first, then reveal again.`
            );
        case CellRevertName.REVEAL_REQUEST_ID_IN_USE:
            return (
                `The randomness source handed back request id ${String(args[0] ?? 'unknown')}, which one of ` +
                `its own open reveals already holds, so nothing was revealed. Settle that open reveal first, ` +
                `then reveal cell ${tokenId} again.`
            );
    }
}

export function isRevealAlreadyPending(error: unknown): boolean {
    const decoded = decodeKnownRevert(error, CELL_ABI, CELL_REVERT_NAMES);
    return decoded !== null && decoded.name === CellRevertName.REVEAL_ALREADY_PENDING;
}

export function withRevealInFlightPhrase(error: unknown, tokenId: string): unknown {
    const decoded = decodeKnownRevert(error, CELL_ABI, CELL_REVERT_NAMES);
    if (decoded === null || decoded.name !== CellRevertName.REVEAL_IN_FLIGHT) {
        return error;
    }
    return new Error(messageFor(CellRevertName.REVEAL_IN_FLIGHT, decoded.args, tokenId), { cause: error });
}

export function withRevealRequestPhrase(error: unknown, tokenId: string): unknown {
    const decoded = decodeKnownRevert(error, CELL_ABI, CELL_REVERT_NAMES);
    if (decoded === null) {
        return withAdapterPhrase(error);
    }
    return new Error(messageFor(decoded.name, decoded.args, tokenId), { cause: error });
}
