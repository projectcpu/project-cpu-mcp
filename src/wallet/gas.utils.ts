import { GAS_LIMIT_MULTIPLIER_BPS } from './constants.js';
import { BPS_DENOMINATOR } from '../config/constants.js';

export function bufferedGasLimit(estimate: bigint): bigint {
    return (estimate * GAS_LIMIT_MULTIPLIER_BPS) / BPS_DENOMINATOR;
}
