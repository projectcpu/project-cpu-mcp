import { isAddress, type Address } from 'viem';

import { MAX_APPROVE_AMOUNT } from './allowance.constants.js';
import { decodeBurnedCpu, feeWeiOf } from './burn.utils.js';
import {
    ModeOperation,
    type ModeSwitchCoordinatorOptions,
    type ModeSwitchReconciliation,
    type PreparedModeSwitchResult,
    type PrepareModeSwitchInput,
    type ReconcileModeSwitchInput,
} from './mode-switch.types.js';
import { AppContract } from './paid-action.types.js';
import { type CatalogBuildingView, ModeCostKind, type ModeKey } from './types.js';
import { modeCost } from '../map/mode.utils.js';
import { cpuFromWei } from '../utils/format.utils.js';

export class ModeSwitchCoordinator {
    private readonly options: ModeSwitchCoordinatorOptions;

    constructor(options: ModeSwitchCoordinatorOptions) {
        this.options = options;
    }

    async prepare<T>(input: PrepareModeSwitchInput<T>): Promise<PreparedModeSwitchResult<T>> {
        const priced = await this.priceContext(input);
        const quote = input.quote(priced.building);
        const cost = modeCost(priced.building, priced.mode, input.target);
        const totalWei = quote.baseCostWei + feeWeiOf(cost);
        let approveTxHash = null;
        const configuredCpuToken = input.action.config.contracts.cpuToken;
        let cpuToken: Address | null = isAddress(configuredCpuToken, { strict: false })
            ? (configuredCpuToken as Address)
            : null;
        if (totalWei > 0n || cost.kind === ModeCostKind.Unknown) {
            cpuToken = input.action.requireContract(AppContract.CpuToken, input.paymentPurpose);
            const needed = cost.kind === ModeCostKind.Unknown ? MAX_APPROVE_AMOUNT : totalWei;
            approveTxHash = await this.options.allowance.ensureAllowance(cpuToken, input.cell, needed);
        }
        return {
            data: quote.data,
            charge: {
                cost,
                exact: priced.exact,
                approveTxHash,
                cpuToken,
                payer: input.action.wallet.getAddress(),
                baseCostWei: quote.baseCostWei,
            },
        };
    }

    reconcile(input: ReconcileModeSwitchInput): ModeSwitchReconciliation {
        const { prepared } = input;
        if (prepared.cpuToken === null || !isAddress(prepared.cpuToken, { strict: false })) {
            return { cost: prepared.cost, exact: prepared.exact, burnedCpu: null };
        }
        const burned = decodeBurnedCpu(input.logs, prepared.cpuToken, prepared.payer) - prepared.baseCostWei;
        return { cost: prepared.cost, exact: prepared.exact, burnedCpu: cpuFromWei(burned.toString()) };
    }

    private async priceContext(
        input: PrepareModeSwitchInput<unknown>,
    ): Promise<{ mode: ModeKey | null; building: CatalogBuildingView | null; exact: boolean }> {
        try {
            const chain = await this.options.cellClient.readCellView(input.cell, input.tokenId);
            const building =
                input.action.config.buildings.find((view) => view.onChainId === chain.buildingType) ?? null;
            const mode =
                input.operation === ModeOperation.Mining
                    ? chain.modeResource === 0
                        ? null
                        : chain.modeResource
                    : chain.modeRecipeId === 0n
                      ? null
                      : chain.modeRecipeId;
            return { mode, building, exact: true };
        } catch (error) {
            this.options.logger.warn('could not read the cell mode on-chain — pricing the switch off the map', {
                tokenId: input.tokenId.toString(),
                error,
            });
            return { mode: input.mapMode, building: input.mapBuilding, exact: false };
        }
    }
}
