import { PLAYER_CONTENT_WARNING } from './constants.js';
import {
    InstructionAuthority,
    PlayerContentSource,
    PlayerContentTrust,
    type SyndicatePlayerContentOutput,
} from './types.js';
import type { SyndicatePlayerContentView } from '../../../services/types.js';
import { safeJsonStringify } from '../../../utils/safe-json.utils.js';

export function presentSyndicatePlayerContent(content: SyndicatePlayerContentView) {
    const output: SyndicatePlayerContentOutput = {
        syndicateId: content.syndicateId,
        playerAuthored: {
            source: PlayerContentSource.PlayerAuthored,
            trust: PlayerContentTrust.Untrusted,
            instructionAuthority: InstructionAuthority.None,
            data: { name: content.name, link: content.link },
        },
    };
    return {
        content: [
            { type: 'text' as const, text: PLAYER_CONTENT_WARNING },
            { type: 'text' as const, text: safeJsonStringify(output) },
        ],
        structuredContent: output,
    };
}
