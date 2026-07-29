import { maxUint256 } from 'viem';

// Approve an unbounded allowance the first time, so subsequent spends find sufficient allowance and skip
// the (gas-costing) approve transaction.
export const MAX_APPROVE_AMOUNT = maxUint256;
