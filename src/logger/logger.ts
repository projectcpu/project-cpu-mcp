import fs from 'node:fs';
import path from 'node:path';

import { LOG_DIR_MODE, LOG_FILE_MODE } from './constants.js';
import { redactString, redactValue } from './redact.utils.js';
import { type ILogger, type LogMeta, LogLevel, type LoggerOptions } from './types.js';

export class Logger implements ILogger {
    private readonly context: string;
    private readonly debugEnabled: boolean;
    private readonly filePath: string | null;
    private fileFailureReported = false;

    constructor(options: LoggerOptions) {
        this.context = options.context;
        this.debugEnabled = options.debugEnabled;
        this.filePath = options.filePath;
    }

    info(message: string, meta?: LogMeta): void {
        this.write(LogLevel.Info, message, meta);
    }

    warn(message: string, meta?: LogMeta): void {
        this.write(LogLevel.Warn, message, meta);
    }

    error(message: string, meta?: LogMeta): void {
        this.write(LogLevel.Error, message, meta);
    }

    debug(message: string, meta?: LogMeta): void {
        if (!this.debugEnabled) {
            return;
        }
        this.write(LogLevel.Debug, message, meta);
    }

    child(childContext: string): Logger {
        return new Logger({
            context: `${this.context}:${childContext}`,
            debugEnabled: this.debugEnabled,
            filePath: this.filePath,
        });
    }

    private write(level: LogLevel, message: string, meta: LogMeta | undefined): void {
        const timestamp = new Date().toISOString();
        const safeMessage = redactString(message);
        const metaPart = meta === undefined ? '' : ` ${JSON.stringify(redactValue(meta))}`;
        const line = `[${timestamp}] [${level}] [${this.context}] ${safeMessage}${metaPart}\n`;
        // stdout belongs to MCP JSON-RPC; stderr remains useful when the host exposes it.
        process.stderr.write(line);
        this.appendToFile(line, timestamp);
    }

    private appendToFile(line: string, timestamp: string): void {
        if (this.filePath === null) return;
        try {
            const directory = path.dirname(this.filePath);
            fs.mkdirSync(directory, { recursive: true, mode: LOG_DIR_MODE });
            fs.chmodSync(directory, LOG_DIR_MODE);
            fs.appendFileSync(this.filePath, line, { encoding: 'utf8', mode: LOG_FILE_MODE });
            fs.chmodSync(this.filePath, LOG_FILE_MODE);
        } catch (error) {
            if (this.fileFailureReported) return;
            this.fileFailureReported = true;
            const errorName = error instanceof Error ? error.name : typeof error;
            process.stderr.write(
                `[${timestamp}] [WARN] [${this.context}] persistent log unavailable ${JSON.stringify({ errorName })}\n`,
            );
        }
    }
}
