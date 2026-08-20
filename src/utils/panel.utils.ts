import {
    PANEL_CHARACTER_SUBSTITUTES,
    PANEL_CONTINUATION_INDENT,
    PANEL_FIELD_SEPARATOR,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_WIDTH,
    PANEL_MISSING_VALUE,
    PANEL_RESERVED_CHARACTERS,
    PANEL_UNKNOWN_SUBSTITUTE,
} from './panel.constants.js';
import type { PanelField, PanelRow, PanelSpec } from './panel.types.js';

function substituted(character: string): string {
    if (!PANEL_RESERVED_CHARACTERS.includes(character)) {
        return character;
    }
    return PANEL_CHARACTER_SUBSTITUTES.get(character) ?? PANEL_UNKNOWN_SUBSTITUTE;
}

function sanitize(text: string): string {
    return [...text.replace(/\s+/gu, ' ')]
        .map((character) => substituted(character))
        .join('')
        .trim();
}

function fieldText(field: PanelField): string {
    const value = field.value === null ? '' : sanitize(field.value);
    return `${sanitize(field.label)}${PANEL_LABEL_SEPARATOR}${value === '' ? PANEL_MISSING_VALUE : value}`;
}

function lineWidth(lines: ReadonlyArray<string>): number {
    return lines.length === 0 ? PANEL_MAX_WIDTH : PANEL_MAX_WIDTH - PANEL_CONTINUATION_INDENT.length;
}

function breakPoint(text: string, width: number, earliest: number): number {
    const space = text.slice(0, width + 1).lastIndexOf(' ');
    return space >= earliest ? space : width;
}

function wrapInto(lines: Array<string>, text: string, earliest: number): string {
    let rest = text;
    let cut = earliest;
    while (rest.length > lineWidth(lines)) {
        const at = breakPoint(rest, lineWidth(lines), cut);
        lines.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at).trimStart();
        cut = 1;
    }
    return rest;
}

function indented(lines: ReadonlyArray<string>): Array<string> {
    return lines.map((line, index) => (index === 0 ? line : `${PANEL_CONTINUATION_INDENT}${line}`));
}

function renderTitle(title: string): Array<string> {
    const lines: Array<string> = [];
    const tail = wrapInto(lines, sanitize(title), 1);
    if (tail !== '' || lines.length === 0) {
        lines.push(tail);
    }
    return indented(lines);
}

function renderRow(row: PanelRow): Array<string> {
    const lines: Array<string> = [];
    let current = '';

    for (const field of row) {
        const text = fieldText(field);
        const joined = `${current}${PANEL_FIELD_SEPARATOR}${text}`;
        if (current !== '' && joined.length <= lineWidth(lines)) {
            current = joined;
            continue;
        }
        if (current !== '') {
            lines.push(current);
        }
        current = wrapInto(lines, text, sanitize(field.label).length + PANEL_LABEL_SEPARATOR.length + 1);
    }
    if (current !== '') {
        lines.push(current);
    }

    return indented(lines);
}

export function renderPanel(panel: PanelSpec): string {
    return [...renderTitle(panel.title), ...panel.rows.flatMap((row) => renderRow(row))].join('\n');
}
