export const PANEL_MAX_WIDTH = 72;
export const PANEL_BAR = '|';
export const PANEL_COLON = ':';
export const PANEL_LINE_BREAK = '\n';
export const PANEL_BAR_SUBSTITUTE = '/';
export const PANEL_UNKNOWN_SUBSTITUTE = '?';
export const PANEL_FIELD_SEPARATOR = ` ${PANEL_BAR} `;
export const PANEL_LABEL_SEPARATOR = `${PANEL_COLON} `;
export const PANEL_MISSING_VALUE = 'n/a';
export const PANEL_CONTINUATION_INDENT = '  ';
export const PANEL_COMBINING_MARK = /\p{M}/u;

export const PANEL_STRUCTURAL_SEQUENCES: ReadonlyArray<string> = [
    PANEL_LINE_BREAK,
    PANEL_FIELD_SEPARATOR,
    PANEL_CONTINUATION_INDENT,
];

export const PANEL_RESERVED_CHARACTERS: ReadonlyArray<string> = [
    ...new Set(PANEL_STRUCTURAL_SEQUENCES.join('')),
].filter((character) => !/\s/u.test(character));

export const PANEL_WRAP_TAIL_FORBIDDEN: ReadonlyArray<string> = [PANEL_COLON];

export const PANEL_FIELD_HEAD = /^[^\s:]+: /u;

export const PANEL_CHARACTER_SUBSTITUTES: ReadonlyMap<string, string> = new Map([[PANEL_BAR, PANEL_BAR_SUBSTITUTE]]);

export const PANEL_MAX_LABEL_LENGTH =
    PANEL_MAX_WIDTH - PANEL_CONTINUATION_INDENT.length - PANEL_LABEL_SEPARATOR.length - 1;
