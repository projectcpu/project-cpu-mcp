import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PAYBOX_AUTH_FILE, PAYBOX_DIR_MODE, PAYBOX_FILE_MODE } from './constants.js';
import { type IPayboxAuthStorage, type PayboxAuthRecord, payboxAuthRecordSchema } from './types.js';
import { SESSION_DIR } from '../config/constants.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';

/** Owns only Project CPU's Paybox record; it deliberately never consults SDK configuration. */
export class PayboxAuthStorage implements IPayboxAuthStorage {
    constructor(
        private readonly homeDir: string,
        private readonly logger: ILogger,
        private readonly removeFile: typeof fs.unlinkSync = fs.unlinkSync,
    ) {}

    load(): PayboxAuthRecord | null {
        if (!fs.existsSync(this.filePath)) return null;
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            const result = payboxAuthRecordSchema.safeParse(parsed);
            if (!result.success) throw new Error('invalid or incompatible Paybox auth record');
            return result.data;
        } catch (error) {
            this.logger.warn('Paybox auth record is invalid; removing it', { reason: errorMessage(error) });
            this.clear();
            return null;
        }
    }

    save(record: PayboxAuthRecord): void {
        const validated = payboxAuthRecordSchema.parse(record);
        fs.mkdirSync(this.directory, { recursive: true, mode: PAYBOX_DIR_MODE });
        fs.chmodSync(this.directory, PAYBOX_DIR_MODE);
        const temporary = `${this.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
        let descriptor: number | null = null;
        try {
            descriptor = fs.openSync(temporary, 'wx', PAYBOX_FILE_MODE);
            fs.writeFileSync(descriptor, JSON.stringify(validated, null, 2));
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = null;
            fs.renameSync(temporary, this.filePath);
            fs.chmodSync(this.filePath, PAYBOX_FILE_MODE);
        } finally {
            if (descriptor !== null) fs.closeSync(descriptor);
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }

    clear(): void {
        try {
            this.removeFile(this.filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            this.wipeAfterFailedDelete();
            this.logger.warn('failed to remove Paybox auth record', { reason: errorMessage(error) });
            throw error;
        }
    }

    private wipeAfterFailedDelete(): void {
        let descriptor: number | null = null;
        try {
            descriptor = fs.openSync(this.filePath, 'r+');
            fs.ftruncateSync(descriptor, 0);
            fs.fsyncSync(descriptor);
        } finally {
            if (descriptor !== null) fs.closeSync(descriptor);
        }
    }

    private get directory(): string {
        return path.join(this.homeDir, SESSION_DIR);
    }
    private get filePath(): string {
        return path.join(this.directory, PAYBOX_AUTH_FILE);
    }
}
