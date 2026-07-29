import { redactString, redactValue } from './redact.utils.js';
import { type ILogger, type LogMeta, LogLevel, type LoggerOptions } from './types.js';

export class Logger implements ILogger {
    private readonly context: string;
    private readonly debugEnabled: boolean;

    constructor(options: LoggerOptions) {
        this.context = options.context;
        this.debugEnabled = options.debugEnabled;
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
        });
    }

    private write(level: LogLevel, message: string, meta: LogMeta | undefined): void {
        const timestamp = new Date().toISOString();
        const safeMessage = redactString(message);
        const metaPart = meta === undefined ? '' : ` ${JSON.stringify(redactValue(meta))}`;
        // stderr only: stdout belongs to MCP JSON-RPC
        process.stderr.write(`[${timestamp}] [${level}] [${this.context}] ${safeMessage}${metaPart}\n`);
    }
}
