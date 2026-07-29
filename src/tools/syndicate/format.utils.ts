import type {
    CreateSyndicateResult,
    JoinSyndicateResult,
    LeaveSyndicateResult,
    SetSyndicateParamsResult,
    SyndicateCardView,
    SyndicateDetailView,
    SyndicateMembershipView,
    SyndicateRatesView,
    TransferSyndicateManagerResult,
} from '../../services/types.js';
import { formatUnixSeconds } from '../../utils/format.utils.js';

function summarizeRates(rates: SyndicateRatesView): string {
    return (
        `trade ${rates.tradeDiscountPercent}% off / ${rates.tradeTaxPercent}% tax, ` +
        `transport ${rates.transportDiscountPercent}% off / ${rates.transportTaxPercent}% tax`
    );
}

function summarizeCardLine(card: SyndicateCardView): string {
    return (
        `Syndicate ${card.id} "${card.name}" · ${card.memberCount} member(s) · manager ${card.manager} · ` +
        `${summarizeRates(card.rates)} · created ${formatUnixSeconds(card.createdAt)}`
    );
}

export function summarizeSyndicateList(cards: Array<SyndicateCardView>): string {
    if (cards.length === 0) {
        return 'No syndicates match.';
    }
    return cards.map(summarizeCardLine).join('\n');
}

export function summarizeSyndicateDetail(detail: SyndicateDetailView): string {
    const { card, members } = detail;
    const header = `${summarizeCardLine(card)}${card.link !== '' ? ` · ${card.link}` : ''}`;
    if (members.length === 0) {
        return `${header}\nNo members on this page.`;
    }
    const lines = members
        .map((member) => `  ${member.address} · joined ${formatUnixSeconds(member.joinedAt)}`)
        .join('\n');
    return `${header}\nMembers (${members.length}):\n${lines}`;
}

export function summarizeJoin(result: JoinSyndicateResult): string {
    const leaveClause = `You may leave from ${formatUnixSeconds(result.leaveAvailableAt)} (unix ${result.leaveAvailableAt}).`;
    if (result.name === null || result.rates === null) {
        return (
            `Joined syndicate ${result.syndicateId} · joined ${formatUnixSeconds(result.joinedAt)}. ${leaveClause} ` +
            "Its name and fee rates couldn't be read yet (the projection may lag) — re-check with cpu_get_syndicate."
        );
    }
    return (
        `Joined syndicate ${result.syndicateId} "${result.name}" · joined ${formatUnixSeconds(result.joinedAt)} · ` +
        `${summarizeRates(result.rates)}. ${leaveClause}`
    );
}

export function summarizeCreate(result: CreateSyndicateResult): string {
    const linkClause = result.link !== '' ? ` · ${result.link}` : '';
    return (
        `Created syndicate ${result.syndicateId} "${result.name}"${linkClause} · manager ${result.manager} · ` +
        `${summarizeRates(result.rates)}. You auto-joined at ${formatUnixSeconds(result.joinedAt)}; ` +
        `you may leave from ${formatUnixSeconds(result.leaveAvailableAt)} (unix ${result.leaveAvailableAt}).`
    );
}

export function summarizeSetParams(result: SetSyndicateParamsResult): string {
    const linkClause = result.link !== '' ? ` · ${result.link}` : '';
    return `Updated syndicate ${result.syndicateId} "${result.name}"${linkClause} · ${summarizeRates(result.rates)}.`;
}

export function summarizeTransfer(result: TransferSyndicateManagerResult): string {
    return (
        `Transferred management of syndicate ${result.syndicateId} from ${result.previousManager} to ` +
        `${result.newManager}. The member-tax stream now pays the new manager.`
    );
}

export function summarizeLeave(result: LeaveSyndicateResult): string {
    return `Left syndicate ${result.syndicateId}. You may join another syndicate immediately.`;
}

export function summarizeMembership(membership: SyndicateMembershipView): string {
    if (!membership.member) {
        return `${membership.address} is not in a syndicate.`;
    }
    const cardLine = membership.syndicate !== null ? `\n${summarizeCardLine(membership.syndicate)}` : '';
    const leave =
        membership.leaveAvailableAt !== null
            ? `, can leave from ${formatUnixSeconds(membership.leaveAvailableAt)}`
            : '';
    const joined = membership.joinedAt !== null ? formatUnixSeconds(membership.joinedAt) : 'unknown';
    return `${membership.address} is a member of syndicate ${membership.syndicateId} (joined ${joined}${leave}).${cardLine}`;
}
