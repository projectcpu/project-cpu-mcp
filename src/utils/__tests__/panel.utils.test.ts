import { describe, expect, it } from 'vitest';

import {
    PANEL_BAR,
    PANEL_CHARACTER_SUBSTITUTES,
    PANEL_CONTINUATION_INDENT,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_MAX_WIDTH,
    PANEL_RESERVED_CHARACTERS,
    PANEL_SEQUENCE_ELISIONS,
    PANEL_STRUCTURAL_SEQUENCES,
    PANEL_UNKNOWN_SUBSTITUTE,
} from '../panel.constants.js';
import type { PanelSpec } from '../panel.types.js';
import { renderPanel, substituteFor } from '../panel.utils.js';

const UNBREAKABLE = `0x${'b'.repeat(70)}`;

function lines(panel: string): Array<string> {
    return panel.split('\n');
}

function unwrapped(panel: string): string {
    return lines(panel).reduce((text, line) =>
        line.startsWith(PANEL_CONTINUATION_INDENT) ? `${text} ${line.trim()}` : `${text}\n${line}`,
    );
}

function glued(panel: string): string {
    return lines(panel)
        .map((line) => line.trim())
        .join('');
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

        expect(PANEL_MAX_WIDTH).toBe(72);
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
        expect(panel).toContain('Owner: 0xabc Forged:line');
        expect(occurrences(panel, PANEL_LABEL_SEPARATOR)).toBe(1);
    });

    it('keeps the colons a value really has, dropping only the space that would make one a separator', () => {
        const panel = renderPanel({
            title: 'PANEL',
            rows: [
                [{ label: 'Window', value: '14:32 3:1' }],
                [{ label: 'Note', value: 'Frozen: the live fee is above your tolerance' }],
            ],
        });

        expect(panel).toContain('Window: 14:32 3:1');
        expect(panel).toContain('Note: Frozen:the live fee is above your tolerance');
        expect(occurrences(panel, PANEL_LABEL_SEPARATOR)).toBe(2);
    });

    it('ends no wrapped line on what it left of an elided sequence, so unwrapping adds no field', () => {
        for (let offset = 40; offset < 72; offset += 1) {
            const value = `${'b'.repeat(offset)}:${'c'.repeat(30)}`;
            const panel = renderPanel({ title: 'PANEL', rows: [[{ label: 'Owner', value }]] });

            expect(occurrences(unwrapped(panel), PANEL_LABEL_SEPARATOR)).toBe(1);
            expect(glued(panel)).toContain(`Owner: ${value}`);
            for (const line of lines(panel)) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('writes no named field into a panel, whatever shape the value takes and however it is read', () => {
        const values = [
            ':'.repeat(80),
            `${'b'.repeat(30)}${':'.repeat(50)}`,
            `${':'.repeat(69)}x`,
            `${'\u{1f600}'.repeat(30)}:${'\u{1f600}'.repeat(30)}`,
            'a: b: c: d: '.repeat(12),
            `${'x'.repeat(60)} ${':'.repeat(30)}`,
            PANEL_LABEL_SEPARATOR.repeat(60),
        ];
        for (let offset = 0; offset < 100; offset += 1) {
            values.push(`${'b'.repeat(offset)}:${'c'.repeat(40)}`);
            values.push(`${'b'.repeat(offset)}: ${'c'.repeat(40)}`);
            values.push(`${'x'.repeat(offset)} Stalled: 999 ${'y'.repeat(40)}`);
            values.push(`${'\u{1f600}'.repeat(offset)}x`);
        }

        for (const label of ['Owner', 'X'.repeat(PANEL_MAX_LABEL_LENGTH)]) {
            for (const value of values) {
                const panel = renderPanel({ title: 'PANEL', rows: [[{ label, value }]] });

                expect(unwrapped(panel).match(/[^\s:]: /gu)).toHaveLength(1);
                for (const line of lines(panel)) {
                    expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
                    expect(line.isWellFormed()).toBe(true);
                }
            }
        }
    });

    it('never splits one character in two when it wraps a value', () => {
        const values = ['\u{1f600}'.repeat(60), 'e\u0301'.repeat(60), `0x${'\u{1f600}'.repeat(40)}`];

        for (const value of values) {
            const panel = renderPanel({ title: 'PANEL', rows: [[{ label: 'Owner', value }]] });

            expect(lines(panel).length).toBeGreaterThan(2);
            for (const line of lines(panel)) {
                expect(line.isWellFormed()).toBe(true);
                expect(line.trimStart()).not.toMatch(/^\p{M}/u);
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
            expect(glued(panel)).toContain(`Owner: ${value}`);
        }
    });

    it('breaks a long value at its spaces, keeping every word whole', () => {
        const value = 'word '.repeat(40).trim();
        const panel = renderPanel({ title: 'PANEL', rows: [[{ label: 'Note', value }]] });

        expect(lines(panel).length).toBeGreaterThan(2);
        expect(
            lines(panel)
                .slice(1)
                .map((line) => line.trim())
                .join(' '),
        ).toBe(`Note: ${value}`);
    });

    it('stands in for a structural character it has no substitute for without changing the width', () => {
        expect(substituteFor(PANEL_BAR, new Map())).toBe(PANEL_UNKNOWN_SUBSTITUTE);
        expect(PANEL_UNKNOWN_SUBSTITUTE).toHaveLength(1);
        expect(PANEL_UNKNOWN_SUBSTITUTE).not.toMatch(/\s/u);
        expect(PANEL_STRUCTURAL_SEQUENCES.join('')).not.toContain(PANEL_UNKNOWN_SUBSTITUTE);
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
        const structure = PANEL_STRUCTURAL_SEQUENCES.join('');

        expect(PANEL_RESERVED_CHARACTERS).toContain(PANEL_BAR);
        expect([...structure]).toHaveLength(structure.length);
        for (const [sequence, remainder] of PANEL_SEQUENCE_ELISIONS) {
            expect(remainder.length).toBeGreaterThan(0);
            expect(remainder.length).toBeLessThan(sequence.length);
            expect(sequence).toContain(remainder);
        }

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
