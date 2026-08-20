export const PANEL_MAX_WIDTH = 72;
export const PANEL_BAR = '|';
export const PANEL_BAR_SUBSTITUTE = '/';
export const PANEL_FIELD_SEPARATOR = ` ${PANEL_BAR} `;
export const PANEL_LABEL_SEPARATOR = ': ';
export const PANEL_MISSING_VALUE = 'n/a';
export const PANEL_CONTINUATION_INDENT = '  ';

// Longest label that still leaves room for `: ` plus one value character on a wrapped line; past it a
// label would be stranded alone, ending a line on a bare colon.
export const PANEL_MAX_LABEL_LENGTH =
    PANEL_MAX_WIDTH - PANEL_CONTINUATION_INDENT.length - PANEL_LABEL_SEPARATOR.length - 1;
