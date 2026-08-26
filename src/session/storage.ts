import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { SESSION_DIR_MODE, SESSION_FILE_MODE } from './constants.js';
import { type ISessionStorage, type SessionData, sessionDataSchema } from './types.js';
import { SESSION_DIR, SESSION_FILE } from '../config/constants.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';

export class SessionStorage implements ISessionStorage {
    constructor(
        private readonly homeDir: string,
        private readonly logger: ILogger,
    ) {}

    exists(): boolean {
        return fs.existsSync(this.sessionFile);
    }

    load(): SessionData | null {
        if (!this.exists()) {
            return null;
        }
        try {
            return this.loadJson();
        } catch (error) {
            this.logger.warn('session file is invalid or incompatible; removing and treating as missing', {
                reason: errorMessage(error),
            });
            this.delete();
            return null;
        }
    }

    save(data: SessionData): void {
        const validated = sessionDataSchema.parse(data);

        this.ensureDir();
        this.writeFileAtomic(this.sessionFile, JSON.stringify(validated, null, 2));
    }

    delete(): void {
        this.tryUnlink(this.sessionFile);
    }

    private get sessionDir(): string {
        return path.join(this.homeDir, SESSION_DIR);
    }

    private get sessionFile(): string {
        return path.join(this.sessionDir, SESSION_FILE);
    }

    private loadJson(): SessionData {
        const raw = fs.readFileSync(this.sessionFile, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        const result = sessionDataSchema.safeParse(parsed);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
            throw new Error(`Invalid session file at ${this.sessionFile}: ${issues}`);
        }
        return result.data;
    }

    private ensureDir(): void {
        fs.mkdirSync(this.sessionDir, { recursive: true, mode: SESSION_DIR_MODE });
        fs.chmodSync(this.sessionDir, SESSION_DIR_MODE);
    }

    private writeFileAtomic(filePath: string, contents: string): void {
        const tempFile = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tempFile, contents, { mode: SESSION_FILE_MODE });
        fs.renameSync(tempFile, filePath);
        fs.chmodSync(filePath, SESSION_FILE_MODE);
    }

    private tryUnlink(filePath: string): void {
        try {
            fs.unlinkSync(filePath);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                return;
            }
            this.logger.warn('failed to remove session file', {
                path: filePath,
                reason: errorMessage(error),
            });
        }
    }
}
