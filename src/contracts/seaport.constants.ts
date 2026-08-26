import { parseAbi, type Address } from 'viem';

// Canonical Seaport 1.6 protocol contract. The address, domain name and version must match the
// deployed contract exactly: they are hashed into every EIP-712 order signature, so a wrong value
// produces a signature the protocol rejects.
export const SEAPORT_ADDRESS: Address = '0x0000000000000068F116a894984e2DB1123eB395';

export const SEAPORT_DOMAIN_NAME = 'Seaport';

export const SEAPORT_DOMAIN_VERSION = '1.6';

export const SEAPORT_ORDER_PRIMARY_TYPE = 'OrderComponents';

// The signed order struct. `totalOriginalConsiderationItems` is transport metadata carried beside a
// prepared order and is deliberately absent here: it is not part of the signed message.
export const SEAPORT_ORDER_COMPONENTS_TYPES = {
    OrderComponents: [
        { name: 'offerer', type: 'address' },
        { name: 'zone', type: 'address' },
        { name: 'offer', type: 'OfferItem[]' },
        { name: 'consideration', type: 'ConsiderationItem[]' },
        { name: 'orderType', type: 'uint8' },
        { name: 'startTime', type: 'uint256' },
        { name: 'endTime', type: 'uint256' },
        { name: 'zoneHash', type: 'bytes32' },
        { name: 'salt', type: 'uint256' },
        { name: 'conduitKey', type: 'bytes32' },
        { name: 'counter', type: 'uint256' },
    ],
    OfferItem: [
        { name: 'itemType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'identifierOrCriteria', type: 'uint256' },
        { name: 'startAmount', type: 'uint256' },
        { name: 'endAmount', type: 'uint256' },
    ],
    ConsiderationItem: [
        { name: 'itemType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'identifierOrCriteria', type: 'uint256' },
        { name: 'startAmount', type: 'uint256' },
        { name: 'endAmount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
    ],
} as const;

// Minimal read surface of the deployed protocol contract: the maker's current order counter.
export const SEAPORT_COUNTER_ABI = parseAbi(['function getCounter(address offerer) view returns (uint256 counter)']);
