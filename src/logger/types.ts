export enum LogLevel {
    Debug = 'DEBUG',
    Info = 'INFO',
    Warn = 'WARN',
    Error = 'ERROR',
}

export interface LoggerOptions {
    context: string;
    debugEnabled: boolean;
    filePath: string | null;
}

export type LogMeta = Record<string, unknown>;

export interface FileLogEntry {
    timestamp: string;
    level: LogLevel;
    context: string;
    message: string;
    meta: LogMeta | null;
}

export interface ILogger {
    info(message: string, meta?: LogMeta): void;
    warn(message: string, meta?: LogMeta): void;
    error(message: string, meta?: LogMeta): void;
    debug(message: string, meta?: LogMeta): void;
    child(childContext: string): ILogger;
}
