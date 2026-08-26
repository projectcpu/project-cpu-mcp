import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { collectionApprovalCall, currencyApprovalCall } from '../approval.utils.js';
import { ERC20_ABI } from '../erc20.abi.js';
import { ERC721_OPERATOR_ABI } from '../erc721.abi.js';

const SPENDER = `0x${'7'.repeat(40)}` as Address;

const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

describe('reading a currency approval out of prepared calldata', () => {
    it('reads the spender and the amount an approve call names', () => {
        const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [SPENDER, 42n] });

        expect(currencyApprovalCall(data)).toEqual({ spender: SPENDER, amount: 42n });
    });

    it('refuses a bare approve selector carrying no arguments', () => {
        expect(currencyApprovalCall('0x095ea7b3')).toBeNull();
    });

    it('refuses a transfer that merely looks like an approval of the same contract', () => {
        const data = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer', args: [SPENDER, 42n] });

        expect(currencyApprovalCall(data)).toBeNull();
    });

    it('refuses calldata that decodes to nothing at all', () => {
        expect(currencyApprovalCall('0x')).toBeNull();
        expect(currencyApprovalCall('0xdeadbeef')).toBeNull();
    });
});

describe('reading a collection approval out of prepared calldata', () => {
    it('reads the operator and the flag a setApprovalForAll call names', () => {
        const data = encodeFunctionData({
            abi: ERC721_OPERATOR_ABI,
            functionName: 'setApprovalForAll',
            args: [SPENDER, true],
        });

        expect(collectionApprovalCall(data)).toEqual({ operator: SPENDER, approved: true });
    });

    it('reads a withdrawal of an approval as such rather than as a grant', () => {
        const data = encodeFunctionData({
            abi: ERC721_OPERATOR_ABI,
            functionName: 'setApprovalForAll',
            args: [SPENDER, false],
        });

        expect(collectionApprovalCall(data)).toEqual({ operator: SPENDER, approved: false });
    });

    it('refuses a bare setApprovalForAll selector carrying no arguments', () => {
        expect(collectionApprovalCall('0xa22cb465')).toBeNull();
    });
});
