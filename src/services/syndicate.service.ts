import { isAddress, parseEventLogs, type Address, type Log } from 'viem';
import { z } from 'zod';

import { assertChain } from './assert-chain.utils.js';
import { SYNDICATE_CREATE_FAILED_MESSAGE, SYNDICATE_UPDATE_FAILED_MESSAGE } from './syndicate.constants.js';
import { ratesToRegistry, requireRegistryEvent, toError, toSyndicateCardView } from './syndicate.helpers.js';
import type {
    AppConfig,
    CreateSyndicateInput,
    CreateSyndicateResult,
    GetMembershipInput,
    GetSyndicateInput,
    ISyndicateRegistryClient,
    JoinSyndicateInput,
    JoinSyndicateResult,
    LeaveSyndicateResult,
    ListSyndicatesQuery,
    RegistryRates,
    SetSyndicateParamsInput,
    SetSyndicateParamsResult,
    SyndicateCardView,
    SyndicateDetailView,
    SyndicateMemberView,
    SyndicateMembershipView,
    SyndicatePlayerContentView,
    SyndicateServiceOptions,
    TransferSyndicateManagerInput,
    TransferSyndicateManagerResult,
    IAppConfig,
} from './types.js';
import type { ApiClient } from '../api/client.js';
import {
    type ApiSyndicateCard,
    type ApiSyndicateMembership,
    type ApiSyndicateMemberView,
    apiSyndicateCardSchema,
    apiSyndicateMembershipSchema,
    apiSyndicateMemberViewSchema,
    HttpStatus,
} from '../api/types.js';
import { SYNDICATE_ABI } from '../contracts/syndicate.abi.js';
import type { ILogger } from '../logger/types.js';
import { formatUnixSeconds } from '../utils/format.utils.js';
import { buildQuery } from '../utils/query.utils.js';
import { describeRevert } from '../wallet/revert.utils.js';
import type { WalletProvider } from '../wallet/types.js';

export class SyndicateService {
    private readonly api: ApiClient;
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly registry: ISyndicateRegistryClient;
    private readonly logger: ILogger;
    private cachedCooldownSec: number | null = null;

    constructor(options: SyndicateServiceOptions) {
        this.api = options.api;
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.registry = options.registry;
        this.logger = options.logger;
    }

    invalidateCache(): void {
        this.cachedCooldownSec = null;
    }

    async join(input: JoinSyndicateInput): Promise<JoinSyndicateResult> {
        const { config, registry } = await this.resolveRegistry();

        const id = BigInt(input.id);
        const cooldownSec = await this.cooldownSec(registry);

        this.logger.info('joining syndicate', { id: input.id, network: config.network });
        const receipt = await this.sendJoin(registry, id);
        const joinedAt = this.decodeJoinedAt(receipt.logs, registry);

        const card = await this.readCardBestEffort(input.id);
        return {
            syndicateId: input.id,
            joinedAt,
            leaveAvailableAt: joinedAt + cooldownSec,
            rates: card?.rates ?? null,
        };
    }

    private async readCardBestEffort(id: string): Promise<SyndicateCardView | null> {
        try {
            return await this.getCard(id);
        } catch (enrichError) {
            this.logger.warn('join confirmed but the syndicate card could not be read for enrichment', {
                id,
                error: enrichError,
            });
            return null;
        }
    }

    async leave(): Promise<LeaveSyndicateResult> {
        const { config, registry } = await this.resolveRegistry();

        this.logger.info('leaving syndicate', { network: config.network });
        const receipt = await this.sendLeave(registry);
        return { syndicateId: this.decodeLeftId(receipt.logs, registry), rejoinAvailableImmediately: true };
    }

    async create(input: CreateSyndicateInput): Promise<CreateSyndicateResult> {
        const { config, registry } = await this.resolveRegistry();

        const manager = (input.manager ?? this.wallet.get().getAddress()) as Address;
        const rates = ratesToRegistry(input.rates);
        const cooldownSec = await this.cooldownSec(registry);

        this.logger.info('creating syndicate', { manager, network: config.network });
        const receipt = await this.sendCreate(registry, { name: input.name, link: input.link, manager, rates });
        const syndicateId = this.decodeCreatedId(receipt.logs, registry);
        const joinedAt = this.decodeJoinedAt(receipt.logs, registry);

        return {
            syndicateId,
            manager,
            rates: input.rates,
            joinedAt,
            leaveAvailableAt: joinedAt + cooldownSec,
        };
    }

    async setParams(input: SetSyndicateParamsInput): Promise<SetSyndicateParamsResult> {
        const { config, registry } = await this.resolveRegistry();

        const id = BigInt(input.id);
        const rates = ratesToRegistry(input.rates);

        this.logger.info('updating syndicate params', { id: input.id, network: config.network });
        await this.sendSetParams(registry, { id, name: input.name, link: input.link, rates });

        return { syndicateId: input.id, rates: input.rates };
    }

    async transferManager(input: TransferSyndicateManagerInput): Promise<TransferSyndicateManagerResult> {
        const { config, registry } = await this.resolveRegistry();

        const id = BigInt(input.id);
        const previousManager = this.wallet.get().getAddress();
        const next = input.next as Address;

        this.logger.info('transferring syndicate manager', { id: input.id, next, network: config.network });
        await this.sendTransferManager(registry, { id, next });

        return { syndicateId: input.id, previousManager, newManager: next };
    }

    async listSyndicates(query: ListSyndicatesQuery): Promise<Array<SyndicateCardView>> {
        const qs = buildQuery({
            name: query.name,
            minMembers: query.minMembers,
            maxMembers: query.maxMembers,
            sort: query.sort,
            limit: query.limit,
            offset: query.offset,
        });
        const response = await this.api.request<Array<ApiSyndicateCard>>(`/api/v1/syndicates${qs}`);
        if (response.status !== HttpStatus.Ok) {
            throw new Error(`Failed to list syndicates (HTTP ${response.status}).`);
        }
        z.array(apiSyndicateCardSchema).parse(response.data);
        return response.data.map(toSyndicateCardView);
    }

    async getSyndicate(input: GetSyndicateInput): Promise<SyndicateDetailView> {
        const card = await this.getCard(input.id);
        const members = await this.listMembers(input.id, input.membersLimit, input.membersOffset);
        return { card, members };
    }

    async getPlayerContent(id: string): Promise<SyndicatePlayerContentView> {
        const card = await this.getRawCard(id);
        return { syndicateId: card.id, name: card.name, link: card.link };
    }

    async getMembership(input: GetMembershipInput): Promise<SyndicateMembershipView> {
        const address = input.address ?? this.wallet.get().getAddress();
        this.logger.info('reading syndicate membership', { address });

        const response = await this.api.request<ApiSyndicateMembership | null>(
            `/api/v1/syndicates/player/${encodeURIComponent(address)}`,
        );
        if (response.status !== HttpStatus.Ok) {
            throw new Error(`Failed to read syndicate membership for ${address} (HTTP ${response.status}).`);
        }
        if (response.data === null) {
            return {
                address,
                member: false,
                syndicateId: null,
                joinedAt: null,
                leaveAvailableAt: null,
                syndicate: null,
            };
        }

        const membership = apiSyndicateMembershipSchema.parse(response.data);
        const card = await this.getCard(membership.syndicateId);
        return {
            address,
            member: true,
            syndicateId: membership.syndicateId,
            joinedAt: membership.joinedAt,
            leaveAvailableAt: membership.leaveAvailableAt,
            syndicate: card,
        };
    }

    private async getCard(id: string): Promise<SyndicateCardView> {
        return toSyndicateCardView(await this.getRawCard(id));
    }

    private async getRawCard(id: string): Promise<ApiSyndicateCard> {
        const response = await this.api.request<ApiSyndicateCard>(`/api/v1/syndicates/${encodeURIComponent(id)}`);
        if (response.status === HttpStatus.NotFound) {
            throw new Error(`No syndicate with id ${id} — check the id from cpu_list_syndicates.`);
        }
        if (response.status !== HttpStatus.Ok) {
            throw new Error(`Failed to load syndicate ${id} (HTTP ${response.status}).`);
        }
        return apiSyndicateCardSchema.parse(response.data);
    }

    private async listMembers(
        id: string,
        limit: number | null,
        offset: number | null,
    ): Promise<Array<SyndicateMemberView>> {
        const qs = buildQuery({ limit, offset });
        const response = await this.api.request<Array<ApiSyndicateMemberView>>(
            `/api/v1/syndicates/${encodeURIComponent(id)}/members${qs}`,
        );
        if (response.status !== HttpStatus.Ok) {
            throw new Error(`Failed to list members of syndicate ${id} (HTTP ${response.status}).`);
        }
        z.array(apiSyndicateMemberViewSchema).parse(response.data);
        return response.data.map((member) => ({ address: member.address, joinedAt: member.joinedAt }));
    }

    private async sendJoin(registry: Address, id: bigint): Promise<{ logs: Array<Log> }> {
        try {
            return await this.registry.join({ registry, id });
        } catch (error) {
            throw await this.explainJoinError(error, id);
        }
    }

    private async sendLeave(registry: Address): Promise<{ logs: Array<Log> }> {
        try {
            return await this.registry.leave({ registry });
        } catch (error) {
            throw await this.explainLeaveError(error);
        }
    }

    private async sendCreate(
        registry: Address,
        params: { name: string; link: string; manager: Address; rates: RegistryRates },
    ): Promise<{ logs: Array<Log> }> {
        try {
            return await this.registry.create({ registry, ...params });
        } catch (error) {
            throw await this.explainCreateError(error);
        }
    }

    private async sendSetParams(
        registry: Address,
        params: { id: bigint; name: string; link: string; rates: RegistryRates },
    ): Promise<{ logs: Array<Log> }> {
        try {
            return await this.registry.setParams({ registry, ...params });
        } catch (error) {
            throw this.explainManagerWriteError(error, 'An address argument was the zero address.');
        }
    }

    private async sendTransferManager(
        registry: Address,
        params: { id: bigint; next: Address },
    ): Promise<{ logs: Array<Log> }> {
        try {
            return await this.registry.transferManager({ registry, ...params });
        } catch (error) {
            throw this.explainManagerWriteError(error, 'The successor address cannot be the zero address.');
        }
    }

    private async explainCreateError(error: unknown): Promise<Error> {
        const revert = describeRevert(error, SYNDICATE_ABI);
        if (revert === null) {
            this.logger.error('syndicate creation failed before a contract error could be decoded', { error });
            return new Error(SYNDICATE_CREATE_FAILED_MESSAGE);
        }
        if (revert.startsWith('AlreadyInSyndicate')) {
            return new Error(await this.alreadyInMessage());
        }
        const mapped = this.mapParamsRevert(revert, 'The manager address cannot be the zero address.');
        return mapped ?? new Error(`Execution reverted: ${revert}`);
    }

    private explainManagerWriteError(error: unknown, zeroAddressMessage: string): Error {
        const revert = describeRevert(error, SYNDICATE_ABI);
        if (revert === null) {
            this.logger.error('syndicate update failed before a contract error could be decoded', { error });
            return new Error(SYNDICATE_UPDATE_FAILED_MESSAGE);
        }
        const mapped = this.mapParamsRevert(revert, zeroAddressMessage);
        return mapped ?? new Error(`Execution reverted: ${revert}`);
    }

    private mapParamsRevert(revert: string, zeroAddressMessage: string): Error | null {
        if (revert.startsWith('RateTooHigh')) {
            return new Error('A rate exceeds the 100% cap; each of the four rates must be between 0% and 100%.');
        }
        if (revert.startsWith('NameEmpty')) {
            return new Error('The syndicate name cannot be empty.');
        }
        if (revert.startsWith('NameTooLong')) {
            return new Error('The syndicate name is too long (maximum 64 bytes).');
        }
        if (revert.startsWith('LinkTooLong')) {
            return new Error('The syndicate link is too long (maximum 200 bytes).');
        }
        if (revert.startsWith('NotManager')) {
            return new Error('Only the syndicate manager can do this.');
        }
        if (revert.startsWith('ZeroAddress')) {
            return new Error(zeroAddressMessage);
        }
        return null;
    }

    private async explainJoinError(error: unknown, id: bigint): Promise<Error> {
        const revert = describeRevert(error, SYNDICATE_ABI);
        if (revert === null) {
            return toError(error);
        }
        if (revert.startsWith('SyndicateNotFound')) {
            return new Error(`No syndicate with id ${id.toString()} — check the id from cpu_list_syndicates.`);
        }
        if (revert.startsWith('AlreadyInSyndicate')) {
            return new Error(await this.alreadyInMessage());
        }
        return new Error(`Execution reverted: ${revert}`);
    }

    private async explainLeaveError(error: unknown): Promise<Error> {
        const revert = describeRevert(error, SYNDICATE_ABI);
        if (revert === null) {
            return toError(error);
        }
        if (revert.startsWith('NotInSyndicate')) {
            return new Error('You are not a member of any syndicate; nothing to leave.');
        }
        if (revert.startsWith('CooldownActive')) {
            return new Error(await this.cooldownMessage());
        }
        return new Error(`Execution reverted: ${revert}`);
    }

    private async alreadyInMessage(): Promise<string> {
        try {
            const membership = await this.getMembership({ address: null });
            if (membership.member && membership.syndicateId !== null) {
                return `You are already in syndicate ${membership.syndicateId}. Leave it before joining another.`;
            }
        } catch (enrichError) {
            this.logger.warn('could not resolve current membership for the error message', { error: enrichError });
        }
        return 'You are already a member of a syndicate. Leave it before joining another.';
    }

    private async cooldownMessage(): Promise<string> {
        try {
            const membership = await this.getMembership({ address: null });
            if (membership.leaveAvailableAt !== null) {
                return (
                    `You cannot leave yet — the exit cooldown runs until ${formatUnixSeconds(membership.leaveAvailableAt)} ` +
                    `(unix ${membership.leaveAvailableAt}). Try again after that.`
                );
            }
        } catch (enrichError) {
            this.logger.warn('could not resolve the leave-available time for the error message', {
                error: enrichError,
            });
        }
        return 'You cannot leave yet — the exit cooldown has not elapsed. Try again later.';
    }

    private async cooldownSec(registry: Address): Promise<number> {
        if (this.cachedCooldownSec !== null) {
            return this.cachedCooldownSec;
        }
        const config = await this.registry.getConfig(registry);
        this.cachedCooldownSec = config.exitCooldownSec;
        return this.cachedCooldownSec;
    }

    private decodeCreatedId(logs: Array<Log>, registry: Address): string {
        const events = parseEventLogs({ abi: SYNDICATE_ABI, eventName: 'SyndicateCreated', logs });
        return requireRegistryEvent(
            events,
            registry,
            'Create confirmed on-chain but no SyndicateCreated event was found in the receipt.',
        ).args.id.toString();
    }

    private decodeJoinedAt(logs: Array<Log>, registry: Address): number {
        const events = parseEventLogs({ abi: SYNDICATE_ABI, eventName: 'MemberJoined', logs });
        return Number(
            requireRegistryEvent(
                events,
                registry,
                'Join confirmed on-chain but no MemberJoined event was found in the receipt.',
            ).args.joinedAt,
        );
    }

    private decodeLeftId(logs: Array<Log>, registry: Address): string {
        const events = parseEventLogs({ abi: SYNDICATE_ABI, eventName: 'MemberLeft', logs });
        return requireRegistryEvent(
            events,
            registry,
            'Leave confirmed on-chain but no MemberLeft event was found in the receipt.',
        ).args.id.toString();
    }

    private async resolveRegistry(): Promise<{ config: AppConfig; registry: Address }> {
        const config = await this.appConfig.load();
        assertChain(config.chainId, this.wallet.get().getChainId());
        return { config, registry: this.requireRegistry(config) };
    }

    private requireRegistry(config: AppConfig): Address {
        const registry = config.contracts.syndicate;
        if (registry === null || !isAddress(registry, { strict: false })) {
            throw new Error(
                `The syndicate registry is not deployed on network ${config.network}, so syndicate actions are unavailable here.`,
            );
        }
        return registry;
    }
}
