import os from 'node:os';
import path from 'node:path';

import { Logger } from './logger.js';
import { parseBooleanEnv } from '../config/boolean-env.utils.js';
import { APP_LOG_PREFIX, LOG_FILE, SESSION_DIR } from '../config/constants.js';

export { Logger } from './logger.js';
export { NoopLogger } from './noop.logger.js';
export { LogLevel } from './types.js';
export type { ILogger, LogMeta, LoggerOptions } from './types.js';

function isDebugEnabled(): boolean {
    return parseBooleanEnv(process.env.DEBUG ?? null, false);
}

export function createLogger(
    context: string = APP_LOG_PREFIX,
    filePath: string | null = path.join(os.homedir(), SESSION_DIR, LOG_FILE),
): Logger {
    return new Logger({ context, debugEnabled: isDebugEnabled(), filePath });
}

export const rootLogger = createLogger();
