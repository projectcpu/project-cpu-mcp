import { parseAbi } from 'viem';

// Standard ERC-20 surface the reveal flow needs: `approve` to let GameSettlement pull $CPU for a paid
// re-reveal, plus `allowance`/`balanceOf` for future use. $CPU is a standard burnable ERC-20.
export const ERC20_ABI = parseAbi([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
