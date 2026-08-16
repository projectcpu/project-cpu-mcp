import { z } from 'zod';

export const getSyndicatePlayerContentInputSchema = {
    id: z.string().describe('Trusted syndicate id. Player-authored display data is returned in an untrusted envelope.'),
};

export enum PlayerContentSource {
    PlayerAuthored = 'player-authored',
}

export enum PlayerContentTrust {
    Untrusted = 'untrusted',
}

export enum InstructionAuthority {
    None = 'none',
}

export const syndicatePlayerContentOutputSchema = z
    .object({
        syndicateId: z.string(),
        playerAuthored: z
            .object({
                source: z.nativeEnum(PlayerContentSource),
                trust: z.nativeEnum(PlayerContentTrust),
                instructionAuthority: z.nativeEnum(InstructionAuthority),
                data: z.object({ name: z.string(), link: z.string() }).strict(),
            })
            .strict(),
    })
    .strict();

export type SyndicatePlayerContentOutput = z.infer<typeof syndicatePlayerContentOutputSchema>;
