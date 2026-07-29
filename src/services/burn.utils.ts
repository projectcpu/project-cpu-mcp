import { parseEther, parseEventLogs, zeroAddress, type Address, type Log } from 'viem';

import { ModeCostKind, type ModeCostView } from './types.js';
import { ERC20_ABI } from '../contracts/erc20.abi.js';

export function decodeBurnedCpu(logs: Array<Log>, cpuToken: Address, from: Address): bigint {
    const events = parseEventLogs({ abi: ERC20_ABI, eventName: 'Transfer', logs });
    return events
        .filter(
            (event) =>
                event.address.toLowerCase() === cpuToken.toLowerCase() &&
                event.args.to.toLowerCase() === zeroAddress &&
                event.args.from.toLowerCase() === from.toLowerCase(),
        )
        .reduce((total, event) => total + event.args.value, 0n);
}

export function feeWeiOf(cost: ModeCostView): bigint {
    return cost.kind === ModeCostKind.Paid ? parseEther(cost.costCpu) : 0n;
}
