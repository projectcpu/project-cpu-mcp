// The `cancel(OrderComponents[])` entry point of the deployed Seaport protocol contract. Field order,
// names and types must match the deployed contract exactly: together they decide the function selector
// and how prepared cancellation calldata decodes back into the order it would cancel.
const OFFER_ITEM_COMPONENTS = [
    { name: 'itemType', type: 'uint8', internalType: 'enum ItemType' },
    { name: 'token', type: 'address', internalType: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256', internalType: 'uint256' },
    { name: 'startAmount', type: 'uint256', internalType: 'uint256' },
    { name: 'endAmount', type: 'uint256', internalType: 'uint256' },
] as const;

const CONSIDERATION_ITEM_COMPONENTS = [
    ...OFFER_ITEM_COMPONENTS,
    { name: 'recipient', type: 'address', internalType: 'address payable' },
] as const;

const ORDER_COMPONENTS = [
    { name: 'offerer', type: 'address', internalType: 'address' },
    { name: 'zone', type: 'address', internalType: 'address' },
    { name: 'offer', type: 'tuple[]', internalType: 'struct OfferItem[]', components: OFFER_ITEM_COMPONENTS },
    {
        name: 'consideration',
        type: 'tuple[]',
        internalType: 'struct ConsiderationItem[]',
        components: CONSIDERATION_ITEM_COMPONENTS,
    },
    { name: 'orderType', type: 'uint8', internalType: 'enum OrderType' },
    { name: 'startTime', type: 'uint256', internalType: 'uint256' },
    { name: 'endTime', type: 'uint256', internalType: 'uint256' },
    { name: 'zoneHash', type: 'bytes32', internalType: 'bytes32' },
    { name: 'salt', type: 'uint256', internalType: 'uint256' },
    { name: 'conduitKey', type: 'bytes32', internalType: 'bytes32' },
    { name: 'counter', type: 'uint256', internalType: 'uint256' },
] as const;

export const SEAPORT_CANCEL_FUNCTION = 'cancel';

export const SEAPORT_CANCEL_ABI = [
    {
        type: 'function',
        name: SEAPORT_CANCEL_FUNCTION,
        stateMutability: 'nonpayable',
        inputs: [
            {
                name: 'orders',
                type: 'tuple[]',
                internalType: 'struct OrderComponents[]',
                components: ORDER_COMPONENTS,
            },
        ],
        outputs: [{ name: 'cancelled', type: 'bool', internalType: 'bool' }],
    },
] as const;
