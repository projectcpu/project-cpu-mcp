import { parseAbi } from 'viem';

// Operator surface of a standard ERC-721 collection. A marketplace moves a sold token through the
// operator this call names, so the call has to be decodable before the wallet ever signs it.
export const ERC721_OPERATOR_ABI = parseAbi(['function setApprovalForAll(address operator, bool approved)']);
