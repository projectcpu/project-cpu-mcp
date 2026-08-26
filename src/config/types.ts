import { z } from 'zod';

import { LAUNCH_NETWORK } from './constants.js';

export { Network } from './network.types.js';

export const envSchema = z.object({
    PRIVATE_KEY: z
        .string({ invalid_type_error: 'PRIVATE_KEY is required' })
        .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be a 32-byte hex string'),
    API_URL: z.string().url().nullable(),
    RPC_URL: z.string().url().nullable(),
    NETWORK: z.literal(LAUNCH_NETWORK).default(LAUNCH_NETWORK),
    OPERATOR_PERSONA: z.boolean(),
});

export type EnvConfig = z.infer<typeof envSchema>;
