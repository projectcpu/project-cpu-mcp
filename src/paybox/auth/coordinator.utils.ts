import { PayboxRefreshState, type PayboxAuthRecord } from '../types.js';

export function payboxRefreshState(record: PayboxAuthRecord): PayboxRefreshState {
    return 'refreshState' in record ? record.refreshState : PayboxRefreshState.Ready;
}

export function withPayboxRefreshState(record: PayboxAuthRecord, refreshState: PayboxRefreshState): PayboxAuthRecord {
    return { ...record, refreshState };
}
