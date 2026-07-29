import { AdapterErrorName, type AdapterFailure } from './types.js';
import { RANDOMNESS_ADAPTER_ABI } from '../contracts/randomness-adapter.abi.js';
import { decodeRevert } from '../wallet/revert.utils.js';

const ADAPTER_ERROR_NAMES: ReadonlyArray<AdapterErrorName> = Object.values(AdapterErrorName);

function toAdapterErrorName(name: string): AdapterErrorName | null {
    return ADAPTER_ERROR_NAMES.find((known) => known === name) ?? null;
}

function messageFor(name: AdapterErrorName, args: ReadonlyArray<unknown>): string {
    const at = (index: number): string => String(args[index] ?? 'unknown');
    switch (name) {
        case AdapterErrorName.UNKNOWN_REQUEST:
            return (
                `Reveal request ${at(0)} is no longer open at the randomness source: it has already been ` +
                `fulfilled. Re-read the cell to see the deposits it rolled.`
            );
        case AdapterErrorName.ROUND_MISMATCH:
            return (
                `The beacon handed back round ${at(2)}, but reveal request ${at(0)} is settled only by round ` +
                `${at(1)}. Ask the beacon for round ${at(1)} and fulfil again.`
            );
        case AdapterErrorName.MALFORMED_SIGNATURE:
            return (
                `The randomness source rejected the signature's shape — it verifies 64-byte signatures on its ` +
                `own curve. The beacon this client asked is not the one the source was deployed against; check ` +
                `the beacon the chain config names.`
            );
        case AdapterErrorName.SIGNATURE_DOES_NOT_VERIFY:
            return (
                `The signature of round ${at(0)} is not the one the randomness source verifies against. The ` +
                `beacon this client asked is not the one the source was deployed against; check the beacon the ` +
                `chain config names.`
            );
        case AdapterErrorName.INSUFFICIENT_CALLBACK_GAS:
            return (
                `The fulfilment ran short of gas: the delivery needs ${at(0)} gas for the callback and only ` +
                `${at(1)} was left. Send it again with a higher gas limit.`
            );
        case AdapterErrorName.INSUFFICIENT_FEE:
            return (
                `Gas got more expensive since the fee was quoted: the randomness source now asks ${at(0)} wei ` +
                `and the transaction carried ${at(1)}. Quote again and retry.`
            );
    }
}

export function withAdapterPhrase(error: unknown): unknown {
    const failure = describeAdapterFailure(error);
    return failure === null ? error : new Error(failure.message, { cause: error });
}

export function describeAdapterFailure(error: unknown): AdapterFailure | null {
    const decoded = decodeRevert(error, RANDOMNESS_ADAPTER_ABI);
    if (decoded === null) {
        return null;
    }
    const name = toAdapterErrorName(decoded.name);
    if (name === null) {
        return null;
    }
    return {
        name,
        message: messageFor(name, decoded.args),
        alreadyFulfilled: name === AdapterErrorName.UNKNOWN_REQUEST,
    };
}
