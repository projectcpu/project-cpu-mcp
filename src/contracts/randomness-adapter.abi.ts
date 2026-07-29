export const RANDOMNESS_ADAPTER_ABI = [
    {
        type: 'function',
        name: 'quoteFeeAt',
        inputs: [{ name: 'gasPrice', type: 'uint256', internalType: 'uint256' }],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'requestOf',
        inputs: [{ name: 'requestId', type: 'uint64', internalType: 'uint64' }],
        outputs: [
            { name: 'consumer', type: 'address', internalType: 'address' },
            { name: 'round', type: 'uint64', internalType: 'uint64' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'fulfillReveal',
        inputs: [
            { name: 'requestId', type: 'uint64', internalType: 'uint64' },
            { name: 'round', type: 'uint64', internalType: 'uint64' },
            { name: 'signature', type: 'bytes', internalType: 'bytes' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'error',
        name: 'UnknownRequest',
        inputs: [{ name: 'requestId', type: 'uint64', internalType: 'uint64' }],
    },
    {
        type: 'error',
        name: 'RoundMismatch',
        inputs: [
            { name: 'requestId', type: 'uint64', internalType: 'uint64' },
            { name: 'expected', type: 'uint64', internalType: 'uint64' },
            { name: 'provided', type: 'uint64', internalType: 'uint64' },
        ],
    },
    {
        type: 'error',
        name: 'MalformedSignature',
        inputs: [],
    },
    {
        type: 'error',
        name: 'SignatureDoesNotVerify',
        inputs: [{ name: 'round', type: 'uint64', internalType: 'uint64' }],
    },
    {
        type: 'error',
        name: 'InsufficientCallbackGas',
        inputs: [
            { name: 'budget', type: 'uint256', internalType: 'uint256' },
            { name: 'available', type: 'uint256', internalType: 'uint256' },
        ],
    },
    {
        type: 'error',
        name: 'InsufficientFee',
        inputs: [
            { name: 'quoted', type: 'uint256', internalType: 'uint256' },
            { name: 'attached', type: 'uint256', internalType: 'uint256' },
        ],
    },
] as const;
