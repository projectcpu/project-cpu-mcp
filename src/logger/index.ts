import { Logger } from './logger.js';
import { APP_LOG_PREFIX } from '../config/constants.js';

export { Logger } from './logger.js';
export { NoopLogger } from './noop.logger.js';
export { LogLevel } from './types.js';
export type { ILogger, LogMeta, LoggerOptions } from './types.js';

function isDebugEnabled(): boolean {
    return Boolean(process.env.DEBUG?.trim());
}

export function createLogger(context: string = APP_LOG_PREFIX): Logger {
    return new Logger({ context, debugEnabled: isDebugEnabled() });
}

export const rootLogger = createLogger();
