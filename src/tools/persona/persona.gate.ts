import { PERSONA_GATE_REFUSAL, PERSONA_TOOL_NAME } from './constants.js';
import type { PersonaDelivery } from './types.js';
import type { ToolGate } from '../../version/types.js';

export function createPersonaDelivery(): PersonaDelivery {
    let served = false;
    return {
        isServed: (): boolean => served,
        markServed: (): void => {
            served = true;
        },
    };
}

export function createPersonaGate(delivery: PersonaDelivery): ToolGate {
    return {
        check: async (toolName: string): Promise<Array<string>> => {
            if (toolName === PERSONA_TOOL_NAME || delivery.isServed()) {
                return [];
            }
            throw new Error(PERSONA_GATE_REFUSAL);
        },
    };
}
