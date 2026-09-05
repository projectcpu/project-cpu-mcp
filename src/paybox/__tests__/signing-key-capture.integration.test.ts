import { request } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { SigningKeyCapture } from '../auth/signing-key-capture.js';

const receivers = new Array<SigningKeyCapture>();
const signingKey = `pbxk1.${Buffer.from(JSON.stringify({ p: '1'.repeat(96), s: '2'.repeat(64) })).toString('base64url')}`;

afterEach(() => {
    for (const receiver of receivers.splice(0)) receiver.close();
});

describe('SigningKeyCapture request boundary', () => {
    it('flushes the success page and closes the listener without a finish call', async () => {
        const receiver = new SigningKeyCapture();
        receivers.push(receiver);
        const captureUrl = await receiver.start(new AbortController().signal);
        const key = receiver.waitForKey('https://app.paybox.test/agent-key?client_id=test');
        const submission = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: signingKey }).toString(),
        });

        expect(submission.status).toBe(200);
        expect(await submission.text()).toContain('</html>');
        await expect(key).resolves.toBe(signingKey);
        await expect(fetch(captureUrl)).rejects.toThrow();
    });

    it.each(['http://[', '//['])('rejects malformed target %s and still accepts a signing key', async (target) => {
        const receiver = new SigningKeyCapture();
        receivers.push(receiver);
        const captureUrl = await receiver.start(new AbortController().signal);
        const key = receiver.waitForKey('https://app.paybox.test/agent-key?client_id=test');

        const status = await requestTarget(captureUrl, target);

        expect(status).toBe(400);
        expect((await fetch(captureUrl)).status).toBe(200);
        const submission = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: signingKey }).toString(),
        });
        expect(submission.status).toBe(200);
        await expect(key).resolves.toBe(signingKey);
    });
});

function requestTarget(captureUrl: string, target: string): Promise<number> {
    const url = new URL(captureUrl);
    return new Promise((resolve, reject) => {
        const req = request({ hostname: url.hostname, port: url.port, path: target }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode ?? 0));
        });
        req.on('error', reject);
        req.setTimeout(200, () => req.destroy(new Error('Malformed request did not receive HTTP 400')));
        req.end();
    });
}
