import { mcpResource } from '@paybox-sh/sdk';

import { SystemBrowserOpener } from './browser-opener.js';
import { DEFAULT_DEVICE_START_TIMEOUT_MS } from './constants.js';
import { DeviceAuthorizationClient } from './device-authorization.client.js';
import { agentKeyProvisioningUrl } from './provisioning.utils.js';
import { SigningKeyCapture } from './signing-key-capture.js';
import type { DeviceAuthFlowOptions, DeviceAuthorizationGrant } from './types.js';
import { authAbortError, oauthError } from './utils.js';
import type { IPayboxBrowserOpener, PayboxAuthFlow, PayboxAuthMaterial, PayboxAuthStart } from '../types.js';

export class DeviceAuthFlow implements PayboxAuthFlow {
    private readonly oauth: DeviceAuthorizationClient;
    private operation: AbortController | null = null;
    private completion: Promise<PayboxAuthMaterial> | null = null;
    private disposeCompletion: (() => void) | null = null;

    public constructor(
        private readonly options: DeviceAuthFlowOptions,
        private readonly browserOpener: IPayboxBrowserOpener = new SystemBrowserOpener(),
    ) {
        this.oauth = new DeviceAuthorizationClient(options.issuerUrl, options.httpClient);
    }

    public async start(parentSignal: AbortSignal): Promise<PayboxAuthStart> {
        if (this.operation !== null) throw oauthError('flow already started');
        const operation = new AbortController();
        this.operation = operation;
        this.completion = null;
        this.disposeCompletion = null;
        const capture = new SigningKeyCapture();
        const startSignal = AbortSignal.any([parentSignal, operation.signal]);
        let signal = startSignal;
        const dispose = () => {
            startSignal.removeEventListener('abort', dispose);
            signal.removeEventListener('abort', dispose);
            capture.close();
            // A cancelled request can finish after its replacement has already started.
            if (this.operation === operation) this.operation = null;
        };
        startSignal.addEventListener('abort', dispose, { once: true });
        try {
            const startedAt = Date.now();
            signal = AbortSignal.any([
                startSignal,
                AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_DEVICE_START_TIMEOUT_MS),
            ]);
            signal.addEventListener('abort', dispose, { once: true });
            const grant = await this.oauth.start(signal);
            signal.throwIfAborted();
            signal.removeEventListener('abort', dispose);
            const timeoutMs =
                this.options.timeoutMs === null
                    ? grant.authorization.expiresIn * 1000
                    : Math.max(0, this.options.timeoutMs - (Date.now() - startedAt));
            signal = AbortSignal.any([startSignal, AbortSignal.timeout(Math.ceil(timeoutMs))]);
            signal.addEventListener('abort', dispose, { once: true });
            const captureUrl = await capture.start(signal);
            signal.throwIfAborted();
            const completion = this.complete(grant, capture, captureUrl, signal).catch((error: unknown) => {
                dispose();
                if (signal.aborted) throw authAbortError(signal.reason);
                throw error;
            });
            void completion.catch(() => undefined);
            this.completion = completion;
            this.disposeCompletion = dispose;
            this.openBrowser(grant.authorization.verificationUriComplete);
            return { authorizationUrl: grant.authorization.verificationUriComplete };
        } catch (error) {
            dispose();
            if (signal.aborted) throw authAbortError(signal.reason);
            throw error;
        }
    }

    public async finish(): Promise<PayboxAuthMaterial> {
        const completion = this.completion;
        const dispose = this.disposeCompletion;
        if (completion === null) throw oauthError('flow not started');
        return completion.finally(() => {
            dispose?.();
            if (this.completion === completion) {
                this.completion = null;
                this.disposeCompletion = null;
            }
        });
    }

    private async complete(
        grant: DeviceAuthorizationGrant,
        capture: SigningKeyCapture,
        captureUrl: string,
        signal: AbortSignal,
    ): Promise<PayboxAuthMaterial> {
        const token = await this.oauth.poll(grant, signal);
        signal.throwIfAborted();
        const provisioningUrl = agentKeyProvisioningUrl(this.options.issuerUrl, token.accessToken);
        if (provisioningUrl === null) throw oauthError('signing key provisioning unavailable');
        const key = capture.waitForKey(provisioningUrl);
        // Paybox Connect navigates to key generation in the approving browser.
        // The local form links there as a fallback without opening a duplicate tab.
        this.openBrowser(captureUrl);
        const signingKey = await key;
        signal.throwIfAborted();
        return {
            tokens: {
                clientId: grant.clientId,
                baseUrl: this.options.issuerUrl,
                ...token,
                resource: mcpResource(this.options.issuerUrl),
            },
            signingKey,
        };
    }

    private openBrowser(url: string): void {
        try {
            this.browserOpener.open(url);
        } catch {
            // Authorization returns its URL; the key form retains the provisioning link.
        }
    }
}
