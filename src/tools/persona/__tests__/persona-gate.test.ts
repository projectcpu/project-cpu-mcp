import { describe, expect, it } from 'vitest';

import { PERSONA_GATE_REFUSAL, PERSONA_TOOL_NAME } from '../constants.js';
import { createPersonaDelivery, createPersonaGate } from '../persona.gate.js';

const OTHER_TOOL = 'cpu_get_map';

describe('brief delivery', () => {
    it('starts unserved', () => {
        expect(createPersonaDelivery().isServed()).toBe(false);
    });

    it('is served once marked', () => {
        const delivery = createPersonaDelivery();

        delivery.markServed();

        expect(delivery.isServed()).toBe(true);
    });

    it('stays served when marked again', () => {
        const delivery = createPersonaDelivery();

        delivery.markServed();
        delivery.markServed();

        expect(delivery.isServed()).toBe(true);
    });

    it('does not share its state with another delivery', () => {
        const delivery = createPersonaDelivery();

        delivery.markServed();

        expect(createPersonaDelivery().isServed()).toBe(false);
    });
});

describe('brief gate', () => {
    it('refuses another tool while the brief is unserved', async () => {
        const gate = createPersonaGate(createPersonaDelivery());

        await expect(gate.check(OTHER_TOOL)).rejects.toThrow(PERSONA_GATE_REFUSAL);
    });

    it('lets the brief tool itself through while unserved', async () => {
        const gate = createPersonaGate(createPersonaDelivery());

        await expect(gate.check(PERSONA_TOOL_NAME)).resolves.toEqual([]);
    });

    it('lets another tool through once the brief is served', async () => {
        const delivery = createPersonaDelivery();
        const gate = createPersonaGate(delivery);

        delivery.markServed();

        await expect(gate.check(OTHER_TOOL)).resolves.toEqual([]);
    });

    it('adds no notice of its own', async () => {
        const delivery = createPersonaDelivery();
        const gate = createPersonaGate(delivery);

        delivery.markServed();

        expect(await gate.check(OTHER_TOOL)).toEqual([]);
    });

    it('names the brief tool in the refusal', async () => {
        const gate = createPersonaGate(createPersonaDelivery());

        await expect(gate.check(OTHER_TOOL)).rejects.toThrow(PERSONA_TOOL_NAME);
    });
});
