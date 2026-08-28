import { PayboxLoopbackUnavailableError } from '../errors.js';
import type { PayboxAuthFlow, PayboxAuthMaterial, PayboxAuthStart } from '../types.js';

export class PayboxAuthFlowSession {
    private controller: AbortController | null = null;
    private startResult: PayboxAuthStart | null = null;
    private starting: Promise<PayboxAuthStart> | null = null;
    private completing: Promise<void> | null = null;
    private completionError: Error | null = null;

    constructor(private readonly flow: PayboxAuthFlow) {}

    isActive(): boolean {
        return this.controller !== null || this.completionError !== null;
    }

    hasFailed(): boolean {
        return this.completionError !== null;
    }

    async poll(complete: (material: PayboxAuthMaterial) => Promise<void>): Promise<PayboxAuthStart> {
        if (this.completionError !== null) {
            const error = this.completionError;
            this.completionError = null;
            throw error;
        }
        if (this.startResult !== null) {
            this.beginCompletion(complete);
            return this.startResult;
        }
        return this.start();
    }

    reset(): void {
        const controller = this.controller;
        this.controller = null;
        this.startResult = null;
        this.starting = null;
        this.completing = null;
        this.completionError = null;
        controller?.abort(new Error('Paybox authentication was invalidated.'));
    }

    private start(): Promise<PayboxAuthStart> {
        if (this.starting !== null) return this.starting;
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

    private beginCompletion(complete: (material: PayboxAuthMaterial) => Promise<void>): void {
        if (this.completing !== null) return;
        const controller = this.controller;
        if (controller === null) throw new Error('Paybox authentication flow is unavailable.');
        const completing = this.runCompletion(controller, complete);
        this.completing = completing;
        void completing.catch(() => undefined);
    }

    private async runCompletion(
        controller: AbortController,
        complete: (material: PayboxAuthMaterial) => Promise<void>,
    ): Promise<void> {
        try {
            const material = await this.flow.finish();
            controller.signal.throwIfAborted();
            await complete(material);
            controller.signal.throwIfAborted();
            if (this.controller === controller) this.clearCompletedSession();
        } catch (error) {
            if (this.controller !== controller) return;
            this.controller = null;
            this.startResult = null;
            this.completing = null;
            this.completionError = error instanceof Error ? error : new Error('Paybox authentication failed.');
        }
    }

    private clearCompletedSession(): void {
        this.controller = null;
        this.startResult = null;
        this.completing = null;
        this.completionError = null;
    }
}
