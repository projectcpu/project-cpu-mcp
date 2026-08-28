import { PayboxError } from '@paybox-sh/sdk';

import { redactString } from '../../logger/redact.utils.js';
import type { LogMeta } from '../../logger/types.js';
import { type PayboxRequestContext, type PayboxSdkOperation, type PayboxSdkStage } from '../types.js';

export function payboxSdkFailureLogMeta(
    operation: PayboxSdkOperation,
    stage: PayboxSdkStage,
    requestContext: PayboxRequestContext,
    error: unknown,
    classifiedError: Error,
): LogMeta {
    return {
        operation,
        stage,
        requestContext,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: safeErrorMessage(error),
        httpStatus: error instanceof PayboxError ? error.status : null,
        classifiedErrorName: classifiedError.name,
    };
}

function safeErrorMessage(error: unknown): string | null {
    if (!(error instanceof Error) || error instanceof PayboxError) return null;
    return redactString(error.message);
}
