import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import type { ToolHandler, ToolRegistrar } from '../../tools/types.js';
import { BackendVersion, createBackendVersionGate } from '../backend-version.js';
import { BACKEND_RESET_NOTICE } from '../constants.js';
import { createGuardedRegistrar, createNoticeBuffer, guardToolHandler } from '../tool-guard.js';
import type { IBackendVersionSignal, ToolGate } from '../types.js';

const GUARDED_TOOL = 'cpu_get_map';

function okHandler(text: string): ToolHandler<[]> {
    return () => ({ content: [{ type: 'text', text }] });
}

function silentGate(): ToolGate {
    return { check: async () => [] };
}

function noticeGate(notices: Array<string>): ToolGate {
    let pending = notices;
    return {
        check: async () => {
            const next = pending;
            pending = [];
            return next;
        },
    };
}

function blockingGate(message: string): ToolGate {
    return {
        check: async () => {
            throw new Error(message);
        },
    };
}

function textOf(result: CallToolResult): Array<string> {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type));
}

class FakeBackendVersion implements IBackendVersionSignal {
    public calls = 0;
    public resetOnNextCall = false;
    private pending = false;

    async ensureFresh(): Promise<void> {
        this.calls += 1;
        if (this.resetOnNextCall) {
            this.pending = true;
            this.resetOnNextCall = false;
        }
    }

    takeResetNotice(): boolean {
        const pending = this.pending;
        this.pending = false;
        return pending;
    }
}

function failingHandler(message: string): ToolHandler<[]> {
    return () => {
        throw new Error(message);
    };
}

describe('tool guard', () => {
    it('throws and never reaches the handler when a gate blocks', async () => {
        let handlerCalls = 0;
        const handler: ToolHandler<[]> = () => {
            handlerCalls += 1;
            return { content: [] };
        };

        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [blockingGate('restart required')],
            handler,
            createNoticeBuffer(),
        );

        await expect(guarded()).rejects.toThrow('restart required');
        expect(handlerCalls).toBe(0);
    });

    it('stops at the first blocking gate without running later ones', async () => {
        let laterGateCalls = 0;
        const later: ToolGate = {
            check: async () => {
                laterGateCalls += 1;
                return [];
            },
        };

        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [blockingGate('restart required'), later],
            okHandler('done'),
            createNoticeBuffer(),
        );

        await expect(guarded()).rejects.toThrow('restart required');
        expect(laterGateCalls).toBe(0);
    });

    it('appends a notice to the first result only', async () => {
        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [noticeGate(['update available'])],
            okHandler('done'),
            createNoticeBuffer(),
        );

        const first = await guarded();
        const second = await guarded();

        expect(textOf(first)).toEqual(['done', 'update available']);
        expect(textOf(second)).toEqual(['done']);
    });

    it('keeps the handler result untouched when every gate is silent', async () => {
        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [silentGate(), silentGate()],
            okHandler('done'),
            createNoticeBuffer(),
        );

        expect(textOf(await guarded())).toEqual(['done']);
    });

    it('appends notices from every gate in order', async () => {
        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [noticeGate(['first']), noticeGate(['second'])],
            okHandler('done'),
            createNoticeBuffer(),
        );

        expect(textOf(await guarded())).toEqual(['done', 'first', 'second']);
    });

    it('preserves fields the handler set beside the content', async () => {
        const handler: ToolHandler<[]> = () => ({ content: [{ type: 'text', text: 'boom' }], isError: true });

        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [noticeGate(['update available'])],
            handler,
            createNoticeBuffer(),
        );

        expect((await guarded()).isError).toBe(true);
    });

    it('passes the tool arguments through to the handler', async () => {
        const handler: ToolHandler<[{ tokenId: string }]> = (args) => ({
            content: [{ type: 'text', text: args.tokenId }],
        });

        const guarded = guardToolHandler(GUARDED_TOOL, [silentGate()], handler, createNoticeBuffer());

        expect(textOf(await guarded({ tokenId: '42' }))).toEqual(['42']);
    });
});

describe('reset notice', () => {
    it('rides along on the first answer after a reset and is gone on the next', async () => {
        const version = new FakeBackendVersion();
        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [createBackendVersionGate(version)],
            okHandler('done'),
            createNoticeBuffer(),
        );

        version.resetOnNextCall = true;
        const first = await guarded();
        const second = await guarded();

        expect(textOf(first)).toEqual(['done', BACKEND_RESET_NOTICE]);
        expect(textOf(second)).toEqual(['done']);
    });

    it('survives a handler that threw and lands on the next answer', async () => {
        const version = new FakeBackendVersion();
        const buffer = createNoticeBuffer();
        const gates = [createBackendVersionGate(version)];
        const failing = guardToolHandler(GUARDED_TOOL, gates, failingHandler('cell not found'), buffer);
        const succeeding = guardToolHandler(GUARDED_TOOL, gates, okHandler('done'), buffer);

        version.resetOnNextCall = true;
        await expect(failing()).rejects.toThrow('cell not found');

        expect(textOf(await succeeding())).toEqual(['done', BACKEND_RESET_NOTICE]);
        expect(textOf(await succeeding())).toEqual(['done']);
    });

    it('does not double up when the handler succeeds', async () => {
        const version = new FakeBackendVersion();
        const buffer = createNoticeBuffer();
        const guarded = guardToolHandler(GUARDED_TOOL, [createBackendVersionGate(version)], okHandler('done'), buffer);

        version.resetOnNextCall = true;

        expect(textOf(await guarded())).toEqual(['done', BACKEND_RESET_NOTICE]);
        expect(textOf(await guarded())).toEqual(['done']);
    });

    it('is not doubled when a second reset lands while the first notice is still pending', async () => {
        const version = new FakeBackendVersion();
        const buffer = createNoticeBuffer();
        const gates = [createBackendVersionGate(version)];
        const failing = guardToolHandler(GUARDED_TOOL, gates, failingHandler('cell not found'), buffer);
        const succeeding = guardToolHandler(GUARDED_TOOL, gates, okHandler('done'), buffer);

        version.resetOnNextCall = true;
        await expect(failing()).rejects.toThrow('cell not found');

        version.resetOnNextCall = true;
        expect(textOf(await succeeding())).toEqual(['done', BACKEND_RESET_NOTICE]);
        expect(textOf(await succeeding())).toEqual(['done']);
    });

    it('keeps a pending notice when a later call is blocked outright', async () => {
        const version = new FakeBackendVersion();
        const buffer = createNoticeBuffer();
        const backendGate = createBackendVersionGate(version);
        const failing = guardToolHandler(GUARDED_TOOL, [backendGate], failingHandler('cell not found'), buffer);
        const blocked = guardToolHandler(
            GUARDED_TOOL,
            [blockingGate('restart required'), backendGate],
            okHandler('done'),
            buffer,
        );
        const succeeding = guardToolHandler(GUARDED_TOOL, [backendGate], okHandler('done'), buffer);

        version.resetOnNextCall = true;
        await expect(failing()).rejects.toThrow('cell not found');
        await expect(blocked()).rejects.toThrow('restart required');

        expect(textOf(await succeeding())).toEqual(['done', BACKEND_RESET_NOTICE]);
    });

    it('is shown once for a batch of tool calls that raced the same reset', async () => {
        let answer = 'sha-1';
        const carrier = new BackendVersion({
            probe: async () => answer,
            nowMs: () => now,
            ttlMs: 60_000,
            onChange: async (): Promise<void> => undefined,
            logger: new NoopLogger(),
        });
        let now = 0;
        const buffer = createNoticeBuffer();
        const gates = [createBackendVersionGate(carrier)];
        const guarded = guardToolHandler(GUARDED_TOOL, gates, okHandler('done'), buffer);

        await guarded();
        answer = 'sha-2';
        now += 60_000;

        const batch = await Promise.all([guarded(), guarded(), guarded(), guarded(), guarded()]);

        const withNotice = batch.filter((result) => textOf(result).includes(BACKEND_RESET_NOTICE));
        expect(withNotice).toHaveLength(1);
        expect(textOf(await guarded())).toEqual(['done']);
    });

    it('runs the package check before the backend one and stops there when blocked', async () => {
        const version = new FakeBackendVersion();
        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [blockingGate('restart required'), createBackendVersionGate(version)],
            okHandler('done'),
            createNoticeBuffer(),
        );

        await expect(guarded()).rejects.toThrow('restart required');
        expect(version.calls).toBe(0);
    });

    it('lets a failed reset through as a tool error', async () => {
        const version: IBackendVersionSignal = {
            ensureFresh: async () => {
                throw new Error('could not reload the map');
            },
            takeResetNotice: () => false,
        };
        let handlerCalls = 0;
        const guarded = guardToolHandler(
            GUARDED_TOOL,
            [createBackendVersionGate(version)],
            () => {
                handlerCalls += 1;
                return { content: [] };
            },
            createNoticeBuffer(),
        );

        await expect(guarded()).rejects.toThrow('could not reload the map');
        expect(handlerCalls).toBe(0);
    });
});

describe('guarded registrar', () => {
    it('wraps every handler it registers', async () => {
        let registered: ToolHandler<[]> | null = null;
        const server = {
            registerTool: (_name: string, _config: unknown, callback: ToolHandler<[]>) => {
                registered = callback;
                return null;
            },
        } as unknown as ToolRegistrar;

        const registrar = createGuardedRegistrar(server, [blockingGate('restart required')]);
        registrar.registerTool('cpu_authenticate', { description: 'auth' }, okHandler('done'));

        expect(registered).not.toBeNull();
        await expect((registered as unknown as ToolHandler<[]>)()).rejects.toThrow('restart required');
    });
});
