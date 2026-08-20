import {
    PANEL_CONTINUATION_INDENT,
    PANEL_FIELD_SEPARATOR,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_WIDTH,
    PANEL_MISSING_VALUE,
} from './panel.constants.js';
import type { PanelField, PanelRow, PanelSpec } from './panel.types.js';

function fieldText(field: PanelField): string {
    const collapsed = field.value === null ? '' : field.value.replace(/\s+/gu, ' ').trim();
    const value = collapsed === '' ? PANEL_MISSING_VALUE : collapsed;
    return `${field.label}${PANEL_LABEL_SEPARATOR}${value}`;
}

function breakPoint(text: string, width: number): number {
    const space = text.slice(0, width + 1).lastIndexOf(' ');
    return space > 0 ? space : width;
}

function renderRow(row: PanelRow): Array<string> {
    const lines: Array<string> = [];
    const width = (): number =>
        lines.length === 0 ? PANEL_MAX_WIDTH : PANEL_MAX_WIDTH - PANEL_CONTINUATION_INDENT.length;
    let current = '';

    for (const field of row) {
        const text = fieldText(field);
        const joined = `${current}${PANEL_FIELD_SEPARATOR}${text}`;
        if (current !== '' && joined.length <= width()) {
            current = joined;
            continue;
        }
        if (current !== '') {
            lines.push(current);
        }
        current = text;
        while (current.length > width()) {
            const cut = breakPoint(current, width());
            lines.push(current.slice(0, cut).trimEnd());
            current = current.slice(cut).trimStart();
        }
    }
    if (current !== '') {
        lines.push(current);
    }

    return lines.map((line, index) => (index === 0 ? line : `${PANEL_CONTINUATION_INDENT}${line}`));
}

export function renderPanel(panel: PanelSpec): string {
    return [panel.title, ...panel.rows.flatMap((row) => renderRow(row))].join('\n');
}
