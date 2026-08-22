import { PERSONA_TOOL_DESCRIPTION, PERSONA_TOOL_NAME } from './constants.js';
import { personaText } from './persona.utils.js';
import type { PersonaDelivery } from './types.js';
import type { ToolRegistrar } from '../types.js';

export function registerPersonaTool(server: ToolRegistrar, delivery: PersonaDelivery): void {
    server.registerTool(PERSONA_TOOL_NAME, { description: PERSONA_TOOL_DESCRIPTION, inputSchema: {} }, () => {
        delivery.markServed();
        return { content: [{ type: 'text', text: personaText() }] };
    });
}
