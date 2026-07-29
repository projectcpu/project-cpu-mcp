import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { REDACTED } from '../constants.js';
import { Logger } from '../logger.js';

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

describe('Logger', () => {
    let stderr: ReturnType<typeof captureStderr>;
    let stdoutSpy: MockInstance;

    beforeEach(() => {
        stderr = captureStderr();
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        stderr.restore();
        stdoutSpy.mockRestore();
    });

    it('writes level, context, and message to stderr', () => {
        const logger = new Logger({ context: 'test', debugEnabled: false });
        logger.info('hello');
        expect(stderr.calls).toHaveLength(1);
        expect(stderr.calls[0]).toContain('[INFO]');
        expect(stderr.calls[0]).toContain('[test]');
        expect(stderr.calls[0]).toContain('hello');
    });

    it('never writes to stdout', () => {
        const logger = new Logger({ context: 'test', debugEnabled: true });
        logger.info('x');
        logger.warn('y');
        logger.error('z');
        logger.debug('w');
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('skips debug calls when debug is disabled', () => {
        const logger = new Logger({ context: 'test', debugEnabled: false });
        logger.debug('should not appear');
        expect(stderr.calls).toHaveLength(0);
    });

    it('emits debug calls when debug is enabled', () => {
        const logger = new Logger({ context: 'test', debugEnabled: true });
        logger.debug('visible');
        expect(stderr.calls[0]).toContain('[DEBUG]');
    });

    it('redacts sensitive keys in meta', () => {
        const logger = new Logger({ context: 'test', debugEnabled: false });
        logger.info('auth succeeded', { jwt: 'xyz', user: 'alice' });
        expect(stderr.calls[0]).toContain(REDACTED);
        expect(stderr.calls[0]).toContain('alice');
        expect(stderr.calls[0]).not.toContain('xyz');
    });

    it('redacts 0x-hex private keys in message', () => {
        const logger = new Logger({ context: 'test', debugEnabled: false });
        const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
        logger.info(`signing with ${key}`);
        expect(stderr.calls[0]).toContain(REDACTED);
        expect(stderr.calls[0]).not.toContain(key);
    });

    it('child logger uses parent:child context and inherits debug flag', () => {
        const parent = new Logger({ context: 'app', debugEnabled: true });
        const child = parent.child('session');
        child.debug('inner');
        expect(stderr.calls[0]).toContain('[app:session]');
        expect(stderr.calls[0]).toContain('[DEBUG]');
    });
});
