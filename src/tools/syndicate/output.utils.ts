import type {
    CreateSyndicateResult,
    JoinSyndicateResult,
    SetSyndicateParamsResult,
    SyndicateCardView,
    SyndicateDetailView,
    SyndicateMembershipView,
    SyndicateRatesView,
} from '../../services/types.js';

function syndicateRatesOutput(rates: SyndicateRatesView): SyndicateRatesView {
    return {
        tradeDiscountPercent: rates.tradeDiscountPercent,
        transportDiscountPercent: rates.transportDiscountPercent,
        tradeTaxPercent: rates.tradeTaxPercent,
        transportTaxPercent: rates.transportTaxPercent,
    };
}

export function syndicateCardOutput(card: SyndicateCardView): SyndicateCardView {
    return {
        id: card.id,
        manager: card.manager,
        rates: syndicateRatesOutput(card.rates),
        memberCount: card.memberCount,
        createdAt: card.createdAt,
    };
}

export function syndicateDetailOutput(detail: SyndicateDetailView): SyndicateDetailView {
    return {
        card: syndicateCardOutput(detail.card),
        members: detail.members.map((member) => ({ address: member.address, joinedAt: member.joinedAt })),
    };
}

export function syndicateMembershipOutput(membership: SyndicateMembershipView): SyndicateMembershipView {
    return {
        address: membership.address,
        member: membership.member,
        syndicateId: membership.syndicateId,
        joinedAt: membership.joinedAt,
        leaveAvailableAt: membership.leaveAvailableAt,
        syndicate: membership.syndicate === null ? null : syndicateCardOutput(membership.syndicate),
    };
}

export function joinSyndicateOutput(result: JoinSyndicateResult): JoinSyndicateResult {
    return {
        syndicateId: result.syndicateId,
        joinedAt: result.joinedAt,
        leaveAvailableAt: result.leaveAvailableAt,
        rates: result.rates === null ? null : syndicateRatesOutput(result.rates),
    };
}

export function createSyndicateOutput(result: CreateSyndicateResult): CreateSyndicateResult {
    return {
        syndicateId: result.syndicateId,
        manager: result.manager,
        rates: syndicateRatesOutput(result.rates),
        joinedAt: result.joinedAt,
        leaveAvailableAt: result.leaveAvailableAt,
    };
}

export function setSyndicateParamsOutput(result: SetSyndicateParamsResult): SetSyndicateParamsResult {
    return { syndicateId: result.syndicateId, rates: syndicateRatesOutput(result.rates) };
}
