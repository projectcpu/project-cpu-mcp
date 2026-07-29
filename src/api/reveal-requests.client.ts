import { getAddress } from 'viem';

import { OPEN_REVEAL_REQUESTS_PATH } from './constants.js';
import { describeApiError } from './response.utils.js';
import {
    apiOpenRevealRequestsSchema,
    HttpStatus,
    type IApiReader,
    type IRevealRequestsReader,
    type OpenRevealRequestsView,
    type RevealRequestsClientOptions,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import { buildQuery } from '../utils/query.utils.js';

export class RevealRequestsClient implements IRevealRequestsReader {
    private readonly api: IApiReader;
    private readonly logger: ILogger;

    constructor(options: RevealRequestsClientOptions) {
        this.api = options.api;
        this.logger = options.logger;
    }

    async listOpenRequests(owner: string): Promise<OpenRevealRequestsView> {
        const address = owner.trim();
        if (address === '') {
            throw new Error(
                'Cannot read open reveal requests without an owner address — an unscoped read answers with ' +
                    "every player's requests, not yours.",
            );
        }

        const path = `${OPEN_REVEAL_REQUESTS_PATH}${buildQuery({ owner: address })}`;
        const response = await this.api.request<unknown>(path);
        if (response.status !== HttpStatus.Ok) {
            throw new Error(
                `Failed to read open reveal requests for ${address} (HTTP ${response.status}): ` +
                    describeApiError(response.data),
            );
        }

        const parsed = apiOpenRevealRequestsSchema.parse(response.data);
        this.logger.debug('read open reveal requests', { owner: address, count: parsed.requests.length });

        return {
            serverTime: parsed.serverTime,
            requests: parsed.requests.map((request) => ({
                requestId: request.requestId,
                source: getAddress(request.source),
                tokenId: request.tokenId,
                requestedAt: request.requestedAt,
            })),
        };
    }
}
