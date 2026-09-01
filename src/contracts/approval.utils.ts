import { decodeFunctionData, type Abi, type Hex } from 'viem';

import {
    APPROVAL_ARGUMENT_COUNT,
    COLLECTION_APPROVAL_FUNCTION,
    CURRENCY_APPROVAL_FUNCTION,
} from './approval.constants.js';
import type { CollectionApprovalCall, CurrencyApprovalCall } from './approval.types.js';
import { ERC20_ABI } from './erc20.abi.js';
import { ERC721_OPERATOR_ABI } from './erc721.abi.js';

function approvalArguments(abi: Abi, data: string, functionName: string): ReadonlyArray<unknown> | null {
    let decoded: { functionName: string; args: ReadonlyArray<unknown> | undefined };

    try {
        decoded = decodeFunctionData({ abi, data: data as Hex });
    } catch {
        return null;
    }

    const args = decoded.args ?? [];
    if (decoded.functionName !== functionName || args.length !== APPROVAL_ARGUMENT_COUNT) {
        return null;
    }

    return args;
}

export function currencyApprovalCall(data: string): CurrencyApprovalCall | null {
    const args = approvalArguments(ERC20_ABI as unknown as Abi, data, CURRENCY_APPROVAL_FUNCTION);
    if (args === null) {
        return null;
    }

    const [spender, amount] = args;
    if (typeof spender !== 'string' || typeof amount !== 'bigint') {
        return null;
    }

    return { spender, amount };
}

export function collectionApprovalCall(data: string): CollectionApprovalCall | null {
    const args = approvalArguments(ERC721_OPERATOR_ABI as unknown as Abi, data, COLLECTION_APPROVAL_FUNCTION);
    if (args === null) {
        return null;
    }

    const [operator, approved] = args;
    if (typeof operator !== 'string' || typeof approved !== 'boolean') {
        return null;
    }

    return { operator, approved };
}
