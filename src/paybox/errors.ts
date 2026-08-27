import { PAYBOX_FULL_ACCESS_WALLET_INSTRUCTIONS } from './constants.js';
import {
    PayboxApprovalMode,
    PayboxErrorCode,
    type PayboxFullAccessWalletRequiredErrorData,
    type PayboxWalletSelectionErrorData,
} from './types.js';

export class PayboxLoopbackUnavailableError extends Error {}

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
