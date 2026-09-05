import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { HTML_HEADERS, KEY_BODY_LIMIT_BYTES, LOOPBACK_HOST, LOOPBACK_KEY_PREFIX } from './constants.js';
import { connectionCompletePage, connectionFailedPage, signingKeyPage } from './loopback-page.utils.js';
import { isPbxk1 } from './signing-key.utils.js';
import { authAbortError, oauthError, randomUrlPart } from './utils.js';
import { PayboxLoopbackUnavailableError } from '../errors.js';

export class SigningKeyCapture {
    private readonly keyPath = `${LOOPBACK_KEY_PREFIX}${randomUrlPart()}`;
    private server: Server | null = null;
    private completion: Promise<string> | null = null;
    private resolveKey: ((key: string) => void) | null = null;
    private rejectKey: ((error: Error) => void) | null = null;
    private provisioningUrl: string | null = null;
    private accepted = false;

    public async start(signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        this.completion = new Promise<string>((resolve, reject) => {
            this.resolveKey = resolve;
            this.rejectKey = reject;
        });
        void this.completion.catch(() => undefined);
        const server = createServer((request, response) => this.handle(request, response));
        this.server = server;
        await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
                cleanup();
                reject(authAbortError(signal.reason));
            };
            const onError = (error: Error) => {
                cleanup();
                reject(new PayboxLoopbackUnavailableError('loopback unavailable', { cause: error }));
            };
            const cleanup = () => {
                signal.removeEventListener('abort', onAbort);
                server.off('error', onError);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            server.once('error', onError);
            server.listen(0, LOOPBACK_HOST, () => {
                cleanup();
                resolve();
            });
        });
        signal.throwIfAborted();
        const address = server.address();
        if (address === null || typeof address === 'string') throw oauthError('loopback address unavailable');
        return `http://${LOOPBACK_HOST}:${address.port}${this.keyPath}`;
    }

    public waitForKey(provisioningUrl: string): Promise<string> {
        if (this.completion === null) throw oauthError('key capture not started');
        this.provisioningUrl = provisioningUrl;
        return this.completion;
    }

    public close(): void {
        this.rejectKey?.(oauthError('key capture closed'));
        this.resolveKey = null;
        this.rejectKey = null;
        this.server?.close();
        this.server?.closeAllConnections();
        this.server = null;
    }

    private handle(request: IncomingMessage, response: ServerResponse): void {
        const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);
        if (url.pathname !== this.keyPath) return this.respond(response, 404, 'Not found');
        const provisioningUrl = this.provisioningUrl;
        if (request.method === 'GET') {
            return provisioningUrl === null
                ? this.respond(response, 409, connectionFailedPage())
                : this.respond(response, 200, signingKeyPage(this.keyPath, provisioningUrl, null));
        }
        if (request.method !== 'POST') return this.respond(response, 405, 'Method not allowed');
        if (!String(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
            return this.respond(response, 415, 'Unsupported media type');
        }
        if (provisioningUrl === null) return this.respond(response, 409, connectionFailedPage());
        let body = '';
        let size = 0;
        request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= KEY_BODY_LIMIT_BYTES) body += chunk.toString('utf8');
        });
        request.on('end', () => {
            if (size > KEY_BODY_LIMIT_BYTES) return this.respond(response, 413, 'Request too large');
            if (this.accepted) return this.respond(response, 409, 'Already used');
            const key = new URLSearchParams(body).get('key');
            if (key === null || !isPbxk1(key)) {
                return this.respond(
                    response,
                    400,
                    signingKeyPage(
                        this.keyPath,
                        provisioningUrl,
                        'That is not a valid pbxk1 signing key. Copy the complete value from Paybox and try again.',
                    ),
                );
            }
            this.accepted = true;
            this.respond(response, 200, connectionCompletePage());
            this.resolveKey?.(key);
            this.resolveKey = null;
            this.rejectKey = null;
        });
    }

    private respond(response: ServerResponse, status: number, body: string): void {
        response.writeHead(status, HTML_HEADERS);
        response.end(body);
    }
}
