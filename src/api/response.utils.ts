import { HTTP_MULTIPLE_CHOICES, HTTP_OK, RESPONSE_BODY_SNIPPET_LENGTH } from './constants.js';

/**
 * Reads the body once and parses it as JSON. An empty body on a 2xx response is a legitimate
 * "no content" answer and resolves to `null`. On a non-JSON body — a down server / proxy error page
 * (`<html>...`) — throws a clear, agent-readable error instead of letting a bare
 * `SyntaxError: Unexpected token '<'` surface from `response.json()`.
 */
export async function parseJsonBody<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (text.trim() === '' && response.status >= HTTP_OK && response.status < HTTP_MULTIPLE_CHOICES) {
        return null as T;
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        const contentType = response.headers.get('content-type') ?? 'unknown';
        const snippet = text.trim().replace(/\s+/g, ' ').slice(0, RESPONSE_BODY_SNIPPET_LENGTH);
        throw new Error(
            `The game API returned a non-JSON response (HTTP ${response.status}, content-type "${contentType}"). ` +
                `The server is likely down or unreachable — retry shortly. Body started: ${snippet}`,
        );
    }
}

export function describeApiError(data: unknown): string {
    if (data !== null && typeof data === 'object' && 'message' in data) {
        const message = (data as { message: unknown }).message;
        return Array.isArray(message) ? message.map(String).join('; ') : String(message);
    }
    return JSON.stringify(data);
}
