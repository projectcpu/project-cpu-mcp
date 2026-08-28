import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REDACTED } from '../constants.js';
import { Logger } from '../logger.js';

describe('Logger file sink', () => {
    let temporaryHome: string | null = null;

    afterEach(() => {
        if (temporaryHome !== null) fs.rmSync(temporaryHome, { recursive: true, force: true });
        temporaryHome = null;
    });

    it('persists a redacted log with restrictive filesystem permissions', () => {
        temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
        const directory = path.join(temporaryHome, '.project-cpu');
        const filePath = path.join(directory, 'project-cpu.log');
        const logger = new Logger({
            context: 'test',
            debugEnabled: false,
            filePath,
        });

        logger.warn('credential discovery failed', {
            signingKey: 'pbxk1.secret-signing-key',
            accessToken: 'secret-access-token',
            providerStatus: 422,
        });

        const contents = fs.readFileSync(filePath, 'utf8');
        expect(contents).toContain('[WARN]');
        expect(contents).toContain('credential discovery failed');
        expect(contents).toContain('"providerStatus":422');
        expect(contents).toContain(REDACTED);
        expect(contents).not.toContain('secret-signing-key');
        expect(contents).not.toContain('secret-access-token');
        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
        expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });
});
