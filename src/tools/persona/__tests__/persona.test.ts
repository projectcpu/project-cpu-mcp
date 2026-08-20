import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PANEL_FIELD_SEPARATOR, PANEL_MAX_WIDTH, PANEL_MISSING_VALUE } from '../../../utils/panel.constants.js';
import { renderPanel } from '../../../utils/panel.utils.js';
import type { ToolRegistrar } from '../../types.js';
import {
    PERSONA_ACTION_LOG_TEMPLATE,
    PERSONA_BASE_SUMMARY_TEMPLATE,
    PERSONA_SECTION_ORDER,
    PERSONA_SECTION_SEPARATOR,
    PERSONA_SECTIONS,
    PERSONA_TOOL_NAME,
} from '../constants.js';
import { registerPersonaTool } from '../persona.js';
import { personaText } from '../persona.utils.js';
import { PersonaSection } from '../types.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

interface RegisteredTool {
    name: string;
    description: string;
    inputKeys: Array<string>;
    call: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function register(): RegisteredTool {
    let registered: RegisteredTool | null = null;
    const server = {
        registerTool(
            name: string,
            definition: { description: string; inputSchema: z.ZodRawShape },
            handler: (args: never) => Promise<ToolResult>,
        ): void {
            const schema = z.object(definition.inputSchema);
            registered = {
                name,
                description: definition.description,
                inputKeys: Object.keys(definition.inputSchema),
                call: async (args) => handler(schema.parse(args) as never),
            };
        },
    } as unknown as ToolRegistrar;

    registerPersonaTool(server);
    if (registered === null) {
        throw new Error('tool was not registered');
    }
    return registered;
}

const BRIEF_MIN_CHARS = 3200;
const BRIEF_MAX_CHARS = 4800;
const MEDIA = /cctv|camera|video|footage|screenshot|image|milestone|artwork/iu;
const PROHIBITION = /\b(do not|don't|never|avoid|stop being|refrain)\b/giu;
const MAX_PROHIBITIONS = 3;

describe('persona tool', () => {
    it('takes no input and answers with the brief as one text block', async () => {
        const tool = register();

        const result = await tool.call({});

        expect(tool.name).toBe(PERSONA_TOOL_NAME);
        expect(tool.inputKeys).toEqual([]);
        expect(result.content).toHaveLength(1);
        expect(result.content[0]?.type).toBe('text');
        expect(result.content[0]?.text).toBe(personaText());
    });

    it('holds the brief long enough to carry the role and short enough to be followed', () => {
        const text = personaText();

        expect(text.length).toBeGreaterThan(BRIEF_MIN_CHARS);
        expect(text.length).toBeLessThan(BRIEF_MAX_CHARS);
    });

    it('promises no medium the server cannot produce', () => {
        expect(personaText()).not.toMatch(MEDIA);
        expect(register().description).not.toMatch(MEDIA);
    });

    it('describes the role by what it is, not by a list of prohibitions', () => {
        const prohibitions = personaText().match(PROHIBITION) ?? [];

        expect(prohibitions.length).toBeLessThanOrEqual(MAX_PROHIBITIONS);
    });

    it('carries every part of the brief exactly once', () => {
        const text = personaText();

        expect([...PERSONA_SECTION_ORDER].sort()).toEqual(Object.values(PersonaSection).sort());
        for (const section of PERSONA_SECTION_ORDER) {
            const body = PERSONA_SECTIONS[section];
            expect(body.length).toBeGreaterThan(120);
            expect(text.split(body)).toHaveLength(2);
        }
    });

    it('states the panel bar the code renders, so the two cannot drift apart', () => {
        const text = personaText();

        expect(text).toContain(String(PANEL_MAX_WIDTH));
        expect(text).toContain(PANEL_FIELD_SEPARATOR.trim());
        expect(text).toContain(PANEL_MISSING_VALUE);
    });

    it('ships both templates rendered by the panel renderer itself', () => {
        const text = personaText();

        expect(text).toContain(renderPanel(PERSONA_BASE_SUMMARY_TEMPLATE));
        expect(text).toContain(renderPanel(PERSONA_ACTION_LOG_TEMPLATE));
    });

    it('keeps every template line inside the width the operator is promised', () => {
        const titles = [PERSONA_BASE_SUMMARY_TEMPLATE.title, PERSONA_ACTION_LOG_TEMPLATE.title];
        const blocks = personaText()
            .split(PERSONA_SECTION_SEPARATOR)
            .filter((block) => titles.some((title) => block.startsWith(title)));
        const lines = blocks.flatMap((block) => block.split('\n'));

        expect(blocks).toHaveLength(titles.length);
        expect(lines.filter((line) => line.includes(PANEL_FIELD_SEPARATOR)).length).toBeGreaterThan(3);
        for (const line of lines) {
            expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
        }
    });
});
