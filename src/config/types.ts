import { z } from 'zod';

import { WalletMode } from '../types.js';

// Networks the game ships on. The value strings are the exact `network` values the game API expects in
// requests (e.g. `GET /api/v1/config?network=`, `POST /api/v1/reveal`).
export enum Network {
    ETHEREUM = 'ethereum',
    ETHEREUM_SEPOLIA = 'ethereum_sepolia',
    BASE = 'base',
    BASE_SEPOLIA = 'base_sepolia',
    ROBINHOOD = 'robinhood',
}

export const envSchema = z
    .object({
        WALLET_MODE: z.nativeEnum(WalletMode).default(WalletMode.EVM),
        PRIVATE_KEY: z
            .string()
            .startsWith('0x')
            .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be a 32-byte hex string')
            .nullable(),
        API_URL: z.string().url().nullable(),
        RPC_URL: z.string().url().nullable(),
        NETWORK: z.nativeEnum(Network).default(Network.ROBINHOOD),
    })
    .refine((data) => data.WALLET_MODE !== WalletMode.EVM || data.PRIVATE_KEY !== null, {
        message: 'PRIVATE_KEY is required when WALLET_MODE=evm',
        path: ['PRIVATE_KEY'],
    });

export type EnvConfig = z.infer<typeof envSchema>;
