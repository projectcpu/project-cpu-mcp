import { createRequire } from 'node:module';

import type { Address } from 'viem';

// require, not import: the Uniswap SDKs' ESM build uses directory imports that Node's NodeNext
// resolver rejects at runtime; their CommonJS build resolves cleanly.
const requireCjs = createRequire(import.meta.url);

const v4Sdk = requireCjs('@uniswap/v4-sdk') as typeof import('@uniswap/v4-sdk');
const urSdk = requireCjs('@uniswap/universal-router-sdk') as typeof import('@uniswap/universal-router-sdk');
const coreSdk = requireCjs('@uniswap/sdk-core') as typeof import('@uniswap/sdk-core');

export const V4Planner = v4Sdk.V4Planner;
export const V4Action = v4Sdk.Actions;
export const RoutePlanner = urSdk.RoutePlanner;
export const RouterCommand = urSdk.CommandType;

const { UNIVERSAL_ROUTER_ADDRESS, UniversalRouterVersion } = urSdk;
const { CHAIN_TO_ADDRESSES_MAP } = coreSdk;

// No single router version is deployed on every supported chain: some have nothing below 2.1.1,
// while 2.2.0 is missing on most. Ordered 2.0 first so chains that have it keep the version this
// client has always sent, with 2.1.1 as the fallback for the rest — both take the same v4 command
// encoding, so only the address differs.
const ROUTER_VERSIONS = [UniversalRouterVersion.V2_0, UniversalRouterVersion.V2_1_1];

/** Universal Router address for `chainId`. Throws if no supported router version is deployed there. */
export function universalRouterAddress(chainId: number): Address {
    for (const version of ROUTER_VERSIONS) {
        try {
            return UNIVERSAL_ROUTER_ADDRESS(version, chainId) as Address;
        } catch {
            continue;
        }
    }
    throw new Error(`Uniswap Universal Router is not available for chainId ${chainId}.`);
}

/** Uniswap v4 Quoter address for `chainId`. Throws if v4 is not deployed there. */
export function v4QuoterAddress(chainId: number): Address {
    const byChain = CHAIN_TO_ADDRESSES_MAP as unknown as Record<number, { v4QuoterAddress: string }>;
    const quoter = byChain[chainId]?.v4QuoterAddress;
    if (quoter === undefined || quoter === '') {
        throw new Error(`Uniswap v4 Quoter is not deployed for chainId ${chainId}.`);
    }
    return quoter as Address;
}
