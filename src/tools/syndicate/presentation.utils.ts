import {
    summarizeCreate,
    summarizeJoin,
    summarizeLeave,
    summarizeMembership,
    summarizeSetParams,
    summarizeSyndicateDetail,
    summarizeSyndicateList,
    summarizeTransfer,
} from './format.utils.js';
import { SyndicatePresentationKind, type SyndicatePresentation } from './types.js';
import type {
    CreateSyndicateResult,
    JoinSyndicateResult,
    SetSyndicateParamsResult,
    SyndicateCardView,
    SyndicateDetailView,
    SyndicateMembershipView,
    SyndicateRatesView,
} from '../../services/types.js';

function rates(ratesView: SyndicateRatesView): SyndicateRatesView {
    return {
        tradeDiscountPercent: ratesView.tradeDiscountPercent,
        transportDiscountPercent: ratesView.transportDiscountPercent,
        tradeTaxPercent: ratesView.tradeTaxPercent,
        transportTaxPercent: ratesView.transportTaxPercent,
    };
}

function card(cardView: SyndicateCardView): SyndicateCardView {
    return {
        id: cardView.id,
        manager: cardView.manager,
        rates: rates(cardView.rates),
        memberCount: cardView.memberCount,
        createdAt: cardView.createdAt,
    };
}

function detail(detailView: SyndicateDetailView): SyndicateDetailView {
    return {
        card: card(detailView.card),
        members: detailView.members.map((member) => ({ address: member.address, joinedAt: member.joinedAt })),
    };
}

function membership(membershipView: SyndicateMembershipView): SyndicateMembershipView {
    return {
        address: membershipView.address,
        member: membershipView.member,
        syndicateId: membershipView.syndicateId,
        joinedAt: membershipView.joinedAt,
        leaveAvailableAt: membershipView.leaveAvailableAt,
        syndicate: membershipView.syndicate === null ? null : card(membershipView.syndicate),
    };
}

function joined(result: JoinSyndicateResult): JoinSyndicateResult {
    return {
        syndicateId: result.syndicateId,
        joinedAt: result.joinedAt,
        leaveAvailableAt: result.leaveAvailableAt,
        rates: result.rates === null ? null : rates(result.rates),
    };
}

function created(result: CreateSyndicateResult): CreateSyndicateResult {
    return {
        syndicateId: result.syndicateId,
        manager: result.manager,
        rates: rates(result.rates),
        joinedAt: result.joinedAt,
        leaveAvailableAt: result.leaveAvailableAt,
    };
}

function params(result: SetSyndicateParamsResult): SetSyndicateParamsResult {
    return { syndicateId: result.syndicateId, rates: rates(result.rates) };
}

function trustedPresentation(input: SyndicatePresentation) {
    switch (input.kind) {
        case SyndicatePresentationKind.List: {
            const value = input.value.map(card);
            return { value, summary: `${value.length} syndicate(s)\n${summarizeSyndicateList(value)}` };
        }
        case SyndicatePresentationKind.Detail: {
            const value = detail(input.value);
            return { value, summary: summarizeSyndicateDetail(value) };
        }
        case SyndicatePresentationKind.Membership: {
            const value = membership(input.value);
            return { value, summary: summarizeMembership(value) };
        }
        case SyndicatePresentationKind.Join: {
            const value = joined(input.value);
            return { value, summary: summarizeJoin(value) };
        }
        case SyndicatePresentationKind.Create: {
            const value = created(input.value);
            return { value, summary: summarizeCreate(value) };
        }
        case SyndicatePresentationKind.SetParams: {
            const value = params(input.value);
            return { value, summary: summarizeSetParams(value) };
        }
        case SyndicatePresentationKind.Leave: {
            const value = {
                syndicateId: input.value.syndicateId,
                rejoinAvailableImmediately: input.value.rejoinAvailableImmediately,
            };
            return { value, summary: summarizeLeave(value) };
        }
        case SyndicatePresentationKind.TransferManager: {
            const value = {
                syndicateId: input.value.syndicateId,
                previousManager: input.value.previousManager,
                newManager: input.value.newManager,
            };
            return { value, summary: summarizeTransfer(value) };
        }
    }
}

export function presentSyndicate(input: SyndicatePresentation) {
    const presentation = trustedPresentation(input);
    return {
        content: [
            { type: 'text' as const, text: presentation.summary },
            { type: 'text' as const, text: JSON.stringify(presentation.value) },
        ],
    };
}
