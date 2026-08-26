export enum SeaportItemType {
    Native = 0,
    Erc20 = 1,
    Erc721 = 2,
    Erc1155 = 3,
    Erc721WithCriteria = 4,
    Erc1155WithCriteria = 5,
}

export enum SeaportOrderType {
    FullOpen = 0,
    PartialOpen = 1,
    FullRestricted = 2,
    PartialRestricted = 3,
    Contract = 4,
}
