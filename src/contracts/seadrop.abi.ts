import { parseAbi } from 'viem';

// OpenSea SeaDrop 1.0 router surface — must match the deployed SeaDrop contract. Mint calls go to
// the router (not the NFT) keyed by the land contract as `nftContract`; payment is exact native ETH.
export const SEADROP_ABI = parseAbi([
    // eslint-disable-next-line max-len
    'struct PublicDrop { uint80 mintPrice; uint48 startTime; uint48 endTime; uint16 maxTotalMintableByWallet; uint16 feeBps; bool restrictFeeRecipients; }',
    'function getPublicDrop(address nftContract) view returns (PublicDrop)',
    'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
    'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
]);
