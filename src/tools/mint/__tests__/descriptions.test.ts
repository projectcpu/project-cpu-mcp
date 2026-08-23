import { describe, expect, it } from 'vitest';

import type { MintQuote, MintResult } from '../../../services/types.js';
import { TxStatus } from '../../../wallet/types.js';
import { MINT_CELL_DESCRIPTION, QUOTE_MINT_DESCRIPTION } from '../constants.js';
import { summarizeMint, summarizeMintQuote } from '../format.utils.js';

const PRICE_ASSUMPTIONS = [/\bfree\b/i, /\bpaid in\b/i, /\bpurchase/i, /\bbuy\b/i, /land sale/i, /\bcost\b/i];

const quote: MintQuote = {
    land: '0x0000000000000000000000000000000000000001',
    quantity: 2,
    mintPrice: '0',
    total: '0',
    feeBps: 0,
    startTime: 0,
    endTime: 4_000_000_000,
    maxTotalMintableByWallet: 5,
};

const result: MintResult = {
    land: '0x0000000000000000000000000000000000000001',
    quantity: 2,
    total: '0',
    txHash: '0xmint',
    status: TxStatus.Success,
    blockNumber: '100',
};

describe('mint tool wording', () => {
    it('keeps the tool descriptions neutral about the mint price', () => {
        for (const pattern of PRICE_ASSUMPTIONS) {
            expect(MINT_CELL_DESCRIPTION).not.toMatch(pattern);
            expect(QUOTE_MINT_DESCRIPTION).not.toMatch(pattern);
        }
    });

    it('points both descriptions at the live drop terms', () => {
        expect(MINT_CELL_DESCRIPTION).toMatch(/live|current/i);
        expect(QUOTE_MINT_DESCRIPTION).toMatch(/live|current/i);
    });

    it('keeps quote and result wording neutral about the mint price', () => {
        for (const pattern of PRICE_ASSUMPTIONS) {
            expect(summarizeMintQuote(quote)).not.toMatch(pattern);
            expect(summarizeMint(result)).not.toMatch(pattern);
        }
    });

    it('reports a zero total as the drop terms give it', () => {
        expect(summarizeMintQuote(quote)).toContain('0 ETH');
        expect(summarizeMint(result)).toContain('0 ETH');
    });
});
