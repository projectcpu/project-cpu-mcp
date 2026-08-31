import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { createLogger } from '../index.js';

function captureStderr(): { calls: Array<string>; restore: () => void } {
    const calls: Array<string> = [];
    const original = process.stderr.write.bind(process.stderr);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        calls.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
    });
    return {
        calls,
        restore: () => {
            spy.mockRestore();
            process.stderr.write = original;
        },
    };
}

describe('createLogger DEBUG wiring', () => {
    let stderr: ReturnType<typeof captureStderr>;
    let stdoutSpy: MockInstance;
    const originalDebug = process.env.DEBUG;

    beforeEach(() => {
        stderr = captureStderr();
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        stderr.restore();
        stdoutSpy.mockRestore();
        if (originalDebug === undefined) {
            delete process.env.DEBUG;
        } else {
            process.env.DEBUG = originalDebug;
        }
    });

    it('is disabled when DEBUG is unset', () => {
        delete process.env.DEBUG;
        createLogger('test', null).debug('hidden');
        expect(stderr.calls).toHaveLength(0);
    });

    it('is disabled when DEBUG is an empty string', () => {
        process.env.DEBUG = '';
        createLogger('test', null).debug('hidden');
        expect(stderr.calls).toHaveLength(0);
    });

    it('is enabled when DEBUG=true', () => {
        process.env.DEBUG = 'true';
        createLogger('test', null).debug('visible');
        expect(stderr.calls).toHaveLength(1);
    });

    it('is disabled when DEBUG=false — explicit switching-off actually works', () => {
        process.env.DEBUG = 'false';
        createLogger('test', null).debug('hidden');
        expect(stderr.calls).toHaveLength(0);
    });

    it('does not silently enable debug on a garbage value', () => {
        process.env.DEBUG = 'nonsense';
        createLogger('test', null).debug('hidden');
        expect(stderr.calls).toHaveLength(0);
    });
});
