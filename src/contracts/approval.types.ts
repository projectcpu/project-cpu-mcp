export interface CurrencyApprovalCall {
    spender: string;
    amount: bigint;
}

export interface CollectionApprovalCall {
    operator: string;
    approved: boolean;
}
