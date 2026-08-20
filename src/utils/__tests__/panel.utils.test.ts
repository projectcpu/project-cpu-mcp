import { describe, expect, it } from 'vitest';

import {
    PANEL_BAR,
    PANEL_CHARACTER_SUBSTITUTES,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_MAX_WIDTH,
    PANEL_RESERVED_CHARACTERS,
    PANEL_STRUCTURAL_SEQUENCES,
} from '../panel.constants.js';
import type { PanelSpec } from '../panel.types.js';
import { renderPanel } from '../panel.utils.js';

const UNBREAKABLE = `0x${'b'.repeat(70)}`;

function lines(panel: string): Array<string> {
    return panel.split('\n');
}

function occurrences(text: string, sequence: string): number {
    return text.split(sequence).length - 1;
}

const LEGS = { label: 'Legs', value: '3' };
const TAIL = { label: 'Tail', value: 'ok' };

function probeSpecs(probe: string): Array<PanelSpec> {
    return [
        { title: `ROUTE${probe}STATE`, rows: [[LEGS, TAIL]] },
        { title: 'ROUTE STATE', rows: [[{ label: 'Legs', value: `3${probe}9` }, TAIL]] },
        { title: 'ROUTE STATE', rows: [[{ label: `Le${probe}gs`, value: '3' }, TAIL]] },
    ];
}

describe('renderPanel', () => {
    it('never leaves a label alone on a line when its value has to hard-wrap', () => {
        const shapes = [
            { title: 'ROUTE STATE', rows: [[{ label: 'Hint', value: UNBREAKABLE }]] },
            {
                title: 'ROUTE STATE',
                rows: [
                    [
                        { label: 'Legs', value: '3' },
                        { label: 'Route', value: UNBREAKABLE },
                    ],
                ],
            },
        ];

        for (const spec of shapes) {
            const panel = renderPanel(spec);
            for (const line of lines(panel)) {
                expect(line).not.toMatch(/:(?! )/);
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }

        expect(renderPanel(shapes[0] ?? { title: '', rows: [] })).toMatch(/Hint: 0xbb/);
        expect(renderPanel(shapes[1] ?? { title: '', rows: [] })).toMatch(/Route: 0xbb/);
    });

    it('keeps every line it emits inside the width, the title included', () => {
        const title = 'T'.repeat(90);
        const panel = renderPanel({ title, rows: [[{ label: 'Field', value: UNBREAKABLE }]] });

        for (const line of lines(panel)) {
            expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
        }
        expect(lines(panel).join('').replace(/ /gu, '')).toContain(title);
    });

    it('marks a wrapped line with the continuation indent so it cannot read as a new field', () => {
        const panel = renderPanel({ title: 'PANEL', rows: [[{ label: 'Note', value: 'word '.repeat(40).trim() }]] });
        const [, head, ...tail] = lines(panel);

        expect(head).toMatch(/^Note: word/);
        expect(tail.length).toBeGreaterThan(0);
        for (const line of tail) {
            expect(line).toMatch(/^ {2}\S/);
        }
    });

    it('collapses whitespace inside a value so it cannot forge a panel line', () => {
        const panel = renderPanel({ title: 'PANEL', rows: [[{ label: 'Owner', value: '0xabc\nForged: line' }]] });

        expect(lines(panel)).toHaveLength(2);
        expect(panel).toContain('Owner: 0xabc Forged; line');
    });

    it('prints a missing or blank value instead of dropping its field', () => {
        const panel = renderPanel({
            title: 'PANEL',
            rows: [
                [
                    { label: 'Left', value: null },
                    { label: 'Right', value: '   ' },
                ],
            ],
        });

        expect(panel).toContain('Left: n/a | Right: n/a');
    });
    it('never lets a value introduce something a reader parses as the field separator', () => {
        const panel = renderPanel({
            title: 'ROUTE | STATE',
            rows: [
                [
                    { label: 'Msg', value: 'a|b' },
                    { label: 'Raw', value: ' | ' },
                    { label: 'Chain', value: 'cell-1 | cell-2 | cell-3' },
                ],
            ],
        });

        for (const line of lines(panel)) {
            expect(line.replace(/ \| /gu, '')).not.toContain('|');
        }
        expect(panel).toContain('Msg: a/b');
        expect(panel).toContain('Chain: cell-1 / cell-2 / cell-3');
    });

    it('lets no title, label or value introduce any sequence the format builds its structure from', () => {
        for (const probe of PANEL_STRUCTURAL_SEQUENCES) {
            for (const spec of probeSpecs(probe)) {
                const panel = renderPanel(spec);
                const fields = spec.rows.flat().length;
                const bars = spec.rows.reduce((count, row) => count + row.length - 1, 0);

                expect(lines(panel)).toHaveLength(spec.rows.length + 1);
                expect(occurrences(panel, PANEL_LABEL_SEPARATOR)).toBe(fields);
                expect(occurrences(panel, PANEL_BAR)).toBe(bars);
            }
        }
    });

    it('gives every character its structure is built from a stand-in of the same length', () => {
        expect(PANEL_RESERVED_CHARACTERS).toContain(PANEL_BAR);

        for (const character of PANEL_RESERVED_CHARACTERS) {
            const substitute = PANEL_CHARACTER_SUBSTITUTES.get(character);

            expect(substitute).toHaveLength(character.length);
            expect(substitute).not.toBe(character);
            expect(PANEL_RESERVED_CHARACTERS).not.toContain(substitute);
        }
    });

    it('holds the label rule at the documented label ceiling', () => {
        const panel = renderPanel({
            title: 'PANEL',
            rows: [
                [
                    { label: 'Lead', value: '1' },
                    { label: 'X'.repeat(PANEL_MAX_LABEL_LENGTH), value: UNBREAKABLE },
                ],
                [{ label: 'X'.repeat(PANEL_MAX_LABEL_LENGTH), value: UNBREAKABLE }],
            ],
        });

        for (const line of lines(panel)) {
            expect(line).not.toMatch(/:(?! )/);
            expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
        }
    });

    it('always emits a header line, even when the title is blank', () => {
        expect(lines(renderPanel({ title: '', rows: [[{ label: 'Cell', value: '42' }]] }))).toEqual(['', 'Cell: 42']);
        expect(lines(renderPanel({ title: '   ', rows: [] }))).toEqual(['']);
    });
});
