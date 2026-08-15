import {
    InstructionAuthority,
    PlayerContentSource,
    PlayerContentTrust,
    type SyndicatePlayerContentOutput,
} from './types.js';
import type { SyndicatePlayerContentView } from '../../services/types.js';

export function toSyndicatePlayerContentOutput(content: SyndicatePlayerContentView): SyndicatePlayerContentOutput {
    return {
        syndicateId: content.syndicateId,
        playerAuthored: {
            source: PlayerContentSource.PlayerAuthored,
            trust: PlayerContentTrust.Untrusted,
            instructionAuthority: InstructionAuthority.None,
            data: { name: content.name, link: content.link },
        },
    };
}
