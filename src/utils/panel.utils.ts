import {
    PANEL_CHARACTER_SUBSTITUTES,
    PANEL_COMBINING_MARK,
    PANEL_CONTINUATION_INDENT,
    PANEL_FIELD_HEAD,
    PANEL_FIELD_SEPARATOR,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_WIDTH,
    PANEL_MISSING_VALUE,
    PANEL_RESERVED_CHARACTERS,
    PANEL_UNKNOWN_SUBSTITUTE,
    PANEL_WRAP_TAIL_FORBIDDEN,
} from './panel.constants.js';
import type { PanelField, PanelRow, PanelSpec } from './panel.types.js';

export function substituteFor(character: string, substitutes: ReadonlyMap<string, string>): string {
    return substitutes.get(character) ?? PANEL_UNKNOWN_SUBSTITUTE;
}

function substituted(character: string): string {
    if (!PANEL_RESERVED_CHARACTERS.includes(character)) {
        return character;
    }
    return substituteFor(character, PANEL_CHARACTER_SUBSTITUTES);
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

function splitsCharacter(text: string, at: number): boolean {
    if (at >= text.length) {
        return false;
    }
    const before = text.charCodeAt(at - 1);
    const after = text.charCodeAt(at);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
        return true;
    }
    return PANEL_COMBINING_MARK.test(String.fromCodePoint(text.codePointAt(at) ?? 0));
}

function endsOnForbiddenTail(text: string, at: number): boolean {
    const line = text.slice(0, at).trimEnd();
    return PANEL_WRAP_TAIL_FORBIDDEN.some((tail) => line.endsWith(tail));
}

function opensAsField(text: string, at: number): boolean {
    return PANEL_FIELD_HEAD.test(text.slice(at).trimStart());
}

function opensAsLabel(text: string, at: number, labels: ReadonlyArray<string>): boolean {
    const head = text.slice(at).trimStart();
    return labels.some((label) => head.startsWith(`${label}${PANEL_LABEL_SEPARATOR}`));
}

function damages(text: string, at: number, labels: ReadonlyArray<string>): boolean {
    return (
        splitsCharacter(text, at) ||
        endsOnForbiddenTail(text, at) ||
        opensAsField(text, at) ||
        opensAsLabel(text, at, labels)
    );
}

function backOff(at: number, earliest: number, harmful: (cut: number) => boolean): number | null {
    let cut = at;
    while (harmful(cut)) {
        if (cut <= earliest) {
            return null;
        }
        cut -= 1;
    }
    return cut;
}

function cohesive(text: string, at: number, earliest: number, labels: ReadonlyArray<string>): number {
    return (
        backOff(at, earliest, (cut) => damages(text, cut, labels)) ??
        backOff(at, earliest, (cut) => splitsCharacter(text, cut) || opensAsLabel(text, cut, labels)) ??
        at
    );
}

function breakPoint(text: string, width: number, earliest: number, labels: ReadonlyArray<string>): number {
    const space = text.slice(0, width + 1).lastIndexOf(' ');
    return cohesive(text, space >= earliest ? space : width, earliest, labels);
}

function wrapInto(lines: Array<string>, text: string, earliest: number, labels: ReadonlyArray<string>): string {
    let rest = text;
    let cut = earliest;
    while (rest.length > lineWidth(lines)) {
        const at = breakPoint(rest, lineWidth(lines), cut, labels);
        lines.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at).trimStart();
        cut = 1;
    }
    return rest;
}

function indented(lines: ReadonlyArray<string>): Array<string> {
    return lines.map((line, index) => (index === 0 ? line : `${PANEL_CONTINUATION_INDENT}${line}`));
}

function renderTitle(title: string, labels: ReadonlyArray<string>): Array<string> {
    const lines: Array<string> = [];
    const tail = wrapInto(lines, sanitize(title), 1, labels);
    if (tail !== '' || lines.length === 0) {
        lines.push(tail);
    }
    return indented(lines);
}

function renderRow(row: PanelRow, labels: ReadonlyArray<string>): Array<string> {
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
        current = wrapInto(lines, text, sanitize(field.label).length + PANEL_LABEL_SEPARATOR.length + 1, labels);
    }
    if (current !== '') {
        lines.push(current);
    }

    return indented(lines);
}

export function renderPanel(panel: PanelSpec): string {
    const labels = panel.rows.flat().map((field) => sanitize(field.label));
    return [...renderTitle(panel.title, labels), ...panel.rows.flatMap((row) => renderRow(row, labels))].join('\n');
}
