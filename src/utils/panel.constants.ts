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
    PANEL_LABEL_SEPARATOR,
    PANEL_CONTINUATION_INDENT,
];

export const PANEL_SEQUENCE_ELISIONS: ReadonlyMap<string, string> = new Map(
    [PANEL_LABEL_SEPARATOR].map((sequence) => [sequence, sequence.replace(/\s+/gu, '')]),
);

export const PANEL_RESERVED_CHARACTERS: ReadonlyArray<string> = [
    ...new Set(PANEL_STRUCTURAL_SEQUENCES.filter((sequence) => !PANEL_SEQUENCE_ELISIONS.has(sequence)).join('')),
].filter((character) => !/\s/u.test(character));

export const PANEL_CHARACTER_SUBSTITUTES: ReadonlyMap<string, string> = new Map([[PANEL_BAR, PANEL_BAR_SUBSTITUTE]]);

// Longest label that still leaves room for `: ` plus one value character on a wrapped line; past it a
// label would be stranded alone, ending a line on a bare colon.
export const PANEL_MAX_LABEL_LENGTH =
    PANEL_MAX_WIDTH - PANEL_CONTINUATION_INDENT.length - PANEL_LABEL_SEPARATOR.length - 1;
