import { describe, expect, it } from 'vitest';

import { PANEL_MAX_LABEL_LENGTH, PANEL_MAX_WIDTH } from '../panel.constants.js';
import { renderPanel } from '../panel.utils.js';

const UNBREAKABLE = `0x${'b'.repeat(70)}`;

function lines(panel: string): Array<string> {
    return panel.split('\n');
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
        expect(panel).toContain('Owner: 0xabc Forged: line');
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
