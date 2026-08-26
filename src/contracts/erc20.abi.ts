import { parseAbi } from 'viem';

// $CPU is a standard burnable ERC-20; paid actions use approvals while funding preflights read balances.
export const ERC20_ABI = parseAbi([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
