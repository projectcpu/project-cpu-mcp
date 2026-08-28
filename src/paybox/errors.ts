import { PAYBOX_FULL_ACCESS_WALLET_INSTRUCTIONS } from './constants.js';
import {
    PayboxApprovalMode,
    PayboxErrorCode,
    PayboxFailureClass,
    PayboxResetCause,
    PayboxResetDepth,
    type PayboxFailureDiagnostic,
    type PayboxFullAccessWalletRequiredErrorData,
    type PayboxOperationDeniedErrorData,
    type PayboxTemporarilyUnavailableErrorData,
    type PayboxWalletSelectionErrorData,
} from './types.js';

export class PayboxLoopbackUnavailableError extends Error {}

export class PayboxAuthInvalidError extends Error {
    readonly diagnostic: PayboxFailureDiagnostic;

    constructor(
        message: string,
        resetCause: PayboxResetCause = PayboxResetCause.InvalidSigningAuthority,
        options: ErrorOptions | null = null,
    ) {
        super(message, options ?? undefined);
        this.name = 'PayboxAuthInvalidError';
        this.diagnostic = {
            failureClass: PayboxFailureClass.ConfirmedAuthentication,
            resetCause,
            resetDepth: PayboxResetDepth.Full,
        };
    }
}

export class PayboxOperationDeniedError extends Error {
    readonly data: PayboxOperationDeniedErrorData = { code: PayboxErrorCode.OperationDenied };
    readonly diagnostic: PayboxFailureDiagnostic = {
        failureClass: PayboxFailureClass.OperationDenied,
        resetCause: null,
        resetDepth: PayboxResetDepth.None,
    };

    constructor() {
        super(JSON.stringify({ code: PayboxErrorCode.OperationDenied }));
        this.name = 'PayboxOperationDeniedError';
    }
}

export class PayboxTemporarilyUnavailableError extends Error {
    readonly data: PayboxTemporarilyUnavailableErrorData = {
        code: PayboxErrorCode.TemporarilyUnavailable,
        stateCleared: false,
        retryable: true,
    };
    readonly diagnostic: PayboxFailureDiagnostic = {
        failureClass: PayboxFailureClass.TemporarilyUnavailable,
        resetCause: null,
        resetDepth: PayboxResetDepth.None,
    };

    constructor(options: ErrorOptions | null = null) {
        const data: PayboxTemporarilyUnavailableErrorData = {
            code: PayboxErrorCode.TemporarilyUnavailable,
            stateCleared: false,
            retryable: true,
        };
        super(JSON.stringify(data), options ?? undefined);
        this.name = 'PayboxTemporarilyUnavailableError';
    }
}

export class PayboxFullAccessWalletRequiredError extends Error {
    readonly data: PayboxFullAccessWalletRequiredErrorData;

    constructor(managementUrl: string | null) {
        const data: PayboxFullAccessWalletRequiredErrorData = {
            code: PayboxErrorCode.FullAccessWalletRequired,
            instructions: PAYBOX_FULL_ACCESS_WALLET_INSTRUCTIONS,
            requiredMode: PayboxApprovalMode.Autonomous,
            managementUrl,
        };
        super(JSON.stringify(data));
        this.name = 'PayboxFullAccessWalletRequiredError';
        this.data = data;
    }
}

export class PayboxWalletSelectionError extends Error {
    readonly data: PayboxWalletSelectionErrorData;

    constructor(code: PayboxErrorCode.WalletSelectionInvalid | PayboxErrorCode.WalletSelectionNotPending) {
        const data: PayboxWalletSelectionErrorData = { code };
        super(JSON.stringify(data));
        this.name = 'PayboxWalletSelectionError';
        this.data = data;
    }
}
