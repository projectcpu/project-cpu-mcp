import { UpgradeRevertName } from './types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import { resourceLabel, type ResourceNames } from '../utils/format.utils.js';
import { decodeRevert } from '../wallet/revert.utils.js';

const UPGRADE_REVERT_NAMES: ReadonlyArray<UpgradeRevertName> = Object.values(UpgradeRevertName);

function toUpgradeRevertName(name: string): UpgradeRevertName | null {
    return UPGRADE_REVERT_NAMES.find((known) => known === name) ?? null;
}

export interface UpgradeRevertContext {
    tokenId: string;
    targetType: string;
    resources: ResourceNames;
}

function messageFor(name: UpgradeRevertName, args: ReadonlyArray<unknown>, context: UpgradeRevertContext): string {
    const { tokenId, targetType, resources } = context;
    switch (name) {
        case UpgradeRevertName.NOT_REVEALED:
            return `Cell ${tokenId} has never been revealed; a building can only be placed or upgraded on a revealed cell.`;
        case UpgradeRevertName.PROCESS_ACTIVE:
            return (
                `Cell ${tokenId} has an active mining or crafting process; claim and finish it first — ` +
                `cpu_upgrade never claims or cancels a process for you.`
            );
        case UpgradeRevertName.DEMOLISH_IN_PROGRESS:
            return (
                `Cell ${tokenId} is still in its demolition cooldown; check cpu_get_cell for when it clears, ` +
                `then upgrade.`
            );
        case UpgradeRevertName.BUILDING_NOT_ENABLED:
            return `${targetType} is not an enabled building on this deployment; check cpu_get_game_config for the current catalog.`;
        case UpgradeRevertName.NOT_A_BASE_BUILDING:
            return (
                `Cell ${tokenId} no longer has a building to upgrade — it may have been demolished since this ` +
                `was checked; re-check with cpu_get_cell.`
            );
        case UpgradeRevertName.INVALID_UPGRADE:
            return (
                `${targetType} is not a direct successor of cell ${tokenId}'s current building; only the ` +
                `immediate next level on the same branch is a valid target — skipped levels and cross-branch ` +
                `jumps are rejected on-chain.`
            );
        case UpgradeRevertName.BUILDING_NOT_READY:
            return (
                `Cell ${tokenId}'s current building has not finished its own construction yet; an upgrade over ` +
                `an unfinished build is rejected on-chain. Wait for it to be ready, then upgrade.`
            );
        case UpgradeRevertName.STORAGE_EXCEEDS_CAP:
            return (
                `Cell ${tokenId} holds more ${resourceLabel(resources, Number(args[0] ?? -1))} than ` +
                `${targetType}'s storage cap allows; transport the excess out before upgrading.`
            );
        case UpgradeRevertName.INSUFFICIENT_LIQUID:
            return (
                `Cell ${tokenId}'s warehouse does not hold ${targetType}'s configured build inputs; check ` +
                `cpu_get_cell for what's on hand and cpu_get_game_config for what ${targetType} needs.`
            );
        case UpgradeRevertName.NOT_CELL_OWNER:
            return `You do not own cell ${tokenId}; only the owner can upgrade it.`;
    }
}

export function withUpgradeRevertPhrase(error: unknown, context: UpgradeRevertContext): unknown {
    const decoded = decodeRevert(error, CELL_ABI);
    if (decoded === null) {
        return error;
    }
    const name = toUpgradeRevertName(decoded.name);
    if (name === null) {
        return error;
    }
    return new Error(messageFor(name, decoded.args, context), { cause: error });
}
