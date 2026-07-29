import { type EnvConfig, envSchema } from './types.js';

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
    // Normalize `undefined` (missing env var) to `null` so inferred types are `string | null`, not `string | undefined`.
    const parsed = envSchema.safeParse({
        WALLET_MODE: env.WALLET_MODE,
        PRIVATE_KEY: env.PRIVATE_KEY ?? null,
        API_URL: env.API_URL ?? null,
        RPC_URL: env.RPC_URL ?? null,
        NETWORK: env.NETWORK,
    });

    if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }

    return parsed.data;
}
