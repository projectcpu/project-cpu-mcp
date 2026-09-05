import { PayboxAuthFlowPollStatus, type PayboxAuthFlowPollResult } from './types.js';
import { PayboxLoopbackUnavailableError } from '../errors.js';
import type { PayboxAuthFlow, PayboxAuthMaterial, PayboxAuthenticateResult, PayboxAuthStart } from '../types.js';

export class PayboxAuthFlowSession {
    private controller: AbortController | null = null;
    private startResult: PayboxAuthStart | null = null;
    private starting: Promise<PayboxAuthStart> | null = null;
    private completing: Promise<void> | null = null;
    private completionResult: PayboxAuthenticateResult | null = null;
    private consumingResult: Promise<PayboxAuthFlowPollResult> | null = null;
    private completionError: Error | null = null;
    private finalizing = false;

    constructor(private readonly flow: PayboxAuthFlow) {}

    isActive(): boolean {
        return (
            this.controller !== null ||
            this.completionResult !== null ||
            this.consumingResult !== null ||
            this.completionError !== null
        );
    }

    async poll(
        complete: (material: PayboxAuthMaterial) => Promise<PayboxAuthenticateResult>,
    ): Promise<PayboxAuthFlowPollResult> {
        if (this.completionError !== null) {
            const error = this.completionError;
            this.completionError = null;
            throw error;
        }
        if (this.consumingResult !== null) return this.consumingResult;
        if (this.completionResult !== null) return this.consumeCompletion();
        if (this.startResult === null) {
            await this.start();
            const pending = this.pendingResult();
            this.beginCompletion(complete);
            return pending;
        }
        if (await this.hasCompletedAuthentication()) {
            if (this.completionResult !== null) return this.consumeCompletion();
        }
        if (this.completionError !== null) {
            const error = this.completionError;
            this.completionError = null;
            throw error;
        }
        return this.pendingResult();
    }

    private pendingResult(): PayboxAuthFlowPollResult {
        if (this.startResult === null) throw new Error('Paybox authentication flow is unavailable.');
        if (this.finalizing) return { status: PayboxAuthFlowPollStatus.Finalizing };
        return {
            status: PayboxAuthFlowPollStatus.Pending,
            authorizationUrl: this.startResult.authorizationUrl,
        };
    }

    reset(): void {
        const controller = this.controller;
        this.controller = null;
        this.startResult = null;
        this.starting = null;
        this.completing = null;
        this.completionResult = null;
        this.consumingResult = null;
        this.completionError = null;
        this.finalizing = false;
        controller?.abort(new Error('Paybox authentication was invalidated.'));
    }

    private start(): Promise<PayboxAuthStart> {
        if (this.starting !== null) return this.starting;
        this.finalizing = false;
        const controller = new AbortController();
        const starting = this.runStart(controller);
        this.controller = controller;
        this.starting = starting;
        return starting;
    }

    private async runStart(controller: AbortController): Promise<PayboxAuthStart> {
        try {
            const result = await this.flow.start(controller.signal);
            controller.signal.throwIfAborted();
            if (this.controller !== controller) throw new Error('Paybox authentication was invalidated.');
            this.startResult = result;
            return result;
        } catch (error) {
            if (this.controller === controller) {
                this.controller = null;
                this.startResult = null;
                this.starting = null;
            }
            if (error instanceof PayboxLoopbackUnavailableError) {
                throw new Error('PAYBOX_AUTH_ENVIRONMENT_UNSUPPORTED', { cause: error });
            }
            throw error;
        } finally {
            if (this.starting !== null && this.controller === controller) this.starting = null;
        }
    }

    private beginCompletion(complete: (material: PayboxAuthMaterial) => Promise<PayboxAuthenticateResult>): void {
        if (this.completing !== null) return;
        const controller = this.controller;
        if (controller === null) throw new Error('Paybox authentication flow is unavailable.');
        const completing = this.runCompletion(controller, complete);
        this.completing = completing;
        void completing.catch(() => undefined);
    }

    private async runCompletion(
        controller: AbortController,
        complete: (material: PayboxAuthMaterial) => Promise<PayboxAuthenticateResult>,
    ): Promise<void> {
        try {
            const material = await this.flow.finish();
            controller.signal.throwIfAborted();
            this.finalizing = true;
            const result = await complete(material);
            controller.signal.throwIfAborted();
            if (this.controller === controller) {
                this.controller = null;
                this.startResult = null;
                this.completing = null;
                this.completionResult = result;
            }
        } catch (error) {
            if (this.controller !== controller) return;
            this.controller = null;
            this.startResult = null;
            this.completing = null;
            this.completionError = error instanceof Error ? error : new Error('Paybox authentication failed.');
        }
    }

    private async hasCompletedAuthentication(): Promise<boolean> {
        const completing = this.completing;
        if (completing === null) return false;
        return Promise.race([
            completing.then(() => this.completionResult !== null),
            new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
        ]);
    }

    private consumeCompletion(): Promise<PayboxAuthFlowPollResult> {
        const result = this.completionResult;
        if (result === null) throw new Error('Paybox authentication result is unavailable.');
        const consuming = Promise.resolve({
            status: PayboxAuthFlowPollStatus.Completed,
            result,
        } as const);
        this.consumingResult = consuming;
        void consuming.finally(() => {
            if (this.consumingResult !== consuming) return;
            this.consumingResult = null;
            this.completionResult = null;
        });
        return consuming;
    }
}
