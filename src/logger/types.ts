export enum LogLevel {
    Debug = 'DEBUG',
    Info = 'INFO',
    Warn = 'WARN',
    Error = 'ERROR',
}

export interface LoggerOptions {
    context: string;
    debugEnabled: boolean;
}

export type LogMeta = Record<string, unknown>;

export interface ILogger {
    info(message: string, meta?: LogMeta): void;
    warn(message: string, meta?: LogMeta): void;
    error(message: string, meta?: LogMeta): void;
    debug(message: string, meta?: LogMeta): void;
    child(childContext: string): ILogger;
}
