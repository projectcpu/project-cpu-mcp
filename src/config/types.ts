import { z } from 'zod';

import { LAUNCH_NETWORK } from './constants.js';
import { WalletMode } from '../types.js';

export { Network } from './network.types.js';

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
        NETWORK: z.literal(LAUNCH_NETWORK).default(LAUNCH_NETWORK),
    })
    .refine((data) => data.WALLET_MODE !== WalletMode.EVM || data.PRIVATE_KEY !== null, {
        message: 'PRIVATE_KEY is required when WALLET_MODE=evm',
        path: ['PRIVATE_KEY'],
    });

export type EnvConfig = z.infer<typeof envSchema>;
