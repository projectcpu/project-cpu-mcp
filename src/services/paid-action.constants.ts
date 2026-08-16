import { AppContract } from './paid-action.types.js';

export const APP_CONTRACT_LABEL: Record<AppContract, string> = {
    [AppContract.Land]: 'Land contract',
    [AppContract.CpuToken]: '$CPU token',
    [AppContract.CpuHook]: '$CPU hook',
    [AppContract.Cell]: 'Cell contract',
    [AppContract.Transport]: 'Transport contract',
    [AppContract.Trade]: 'Trade contract',
    [AppContract.Syndicate]: 'Syndicate registry',
};
