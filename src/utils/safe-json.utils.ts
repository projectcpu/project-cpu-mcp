import { ACTIVE_JSON_STRING_CHARACTERS } from './safe-json.constants.js';

function unicodeEscape(character: string): string {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** Keeps JSON parseable while preventing string values from becoming active Markdown or HTML in text clients. */
export function safeJsonStringify(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error('Safe JSON rendering requires a serializable value.');
    }
    let result = '';
    let insideString = false;
    let escaped = false;

    for (const character of serialized) {
        if (!insideString) {
            result += character;
            if (character === '"') {
                insideString = true;
            }
            continue;
        }
        if (escaped) {
            result += character;
            escaped = false;
            continue;
        }
        if (character === '\\') {
            result += character;
            escaped = true;
            continue;
        }
        if (character === '"') {
            result += character;
            insideString = false;
            continue;
        }
        result +=
            ACTIVE_JSON_STRING_CHARACTERS.has(character) || character === '\u2028' || character === '\u2029'
                ? unicodeEscape(character)
                : character;
    }

    return result;
}
