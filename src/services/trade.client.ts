import { encodeFunctionData, type Hash } from 'viem';

import { namedQuoteRevert } from './trade.helpers.js';
import type {
    BuyLotParams,
    BuyQuoteResult,
    CancelLotParams,
    CreateLotParams,
    EvictLotParams,
    GetLotParams,
    GetLotsParams,
    GetSaleFeeParams,
    GetTradeConfigParams,
    ITradeClient,
    LotBoundParams,
    OnChainLot,
    OnChainTradeConfig,
    QuoteBuyParams,
    QuoteReturnParams,
    QuoteSaleParams,
    ReclaimLotParams,
    ReturnQuoteResult,
    SaleQuoteResult,
    SellerEvictedCountParams,
    SellerLotCountParams,
    SetSaleFeeParams,
    TradeClientOptions,
} from './types.js';
import { TRADE_ABI } from '../contracts/trade.abi.js';
import type { ILogger } from '../logger/types.js';
import type { IContractClient } from '../wallet/types.js';

export class TradeClient implements ITradeClient {
    private readonly contracts: IContractClient;
    private readonly logger: ILogger;

    constructor(options: TradeClientOptions) {
        this.contracts = options.contracts;
        this.logger = options.logger;
    }

    async createLot(params: CreateLotParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'createLot',
            args: [params.tokenIds, params.res, params.value, params.price, params.maxSaleFeeBp, params.maxFee],
        });
        this.logger.info('submitting create lot', {
            trade: params.trade,
            res: params.res,
            value: params.value.toString(),
            priceWei: params.price.toString(),
            maxSaleFeeBp: params.maxSaleFeeBp,
            maxFeeWei: params.maxFee.toString(),
        });
        return this.contracts.send({ to: params.trade, data, value: null, gas: null }, TRADE_ABI);
    }

    async buy(params: BuyLotParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'buy',
            args: [params.lotId, params.value, params.destTokenIds, params.maxFee],
        });
        this.logger.info('submitting buy lot', {
            trade: params.trade,
            lotId: params.lotId.toString(),
            value: params.value.toString(),
            maxFeeWei: params.maxFee.toString(),
        });
        return this.contracts.send({ to: params.trade, data, value: null, gas: null }, TRADE_ABI);
    }

    async cancel(params: CancelLotParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'cancel',
            args: [params.lotId, params.returnTokenIds, params.maxFee],
        });
        this.logger.info('submitting cancel lot', {
            trade: params.trade,
            lotId: params.lotId.toString(),
            maxFeeWei: params.maxFee.toString(),
        });
        return this.contracts.send({ to: params.trade, data, value: null, gas: null }, TRADE_ABI);
    }

    async reclaim(params: ReclaimLotParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'reclaim',
            args: [params.lotId, params.returnTokenIds, params.maxFee],
        });
        this.logger.info('submitting reclaim lot', {
            trade: params.trade,
            lotId: params.lotId.toString(),
            maxFeeWei: params.maxFee.toString(),
        });
        return this.contracts.send({ to: params.trade, data, value: null, gas: null }, TRADE_ABI);
    }

    async evict(params: EvictLotParams): Promise<Hash> {
        const data = encodeFunctionData({ abi: TRADE_ABI, functionName: 'evict', args: [params.lotId] });
        this.logger.info('submitting evict lot', { trade: params.trade, lotId: params.lotId.toString() });
        return this.contracts.send({ to: params.trade, data, value: null, gas: null }, TRADE_ABI);
    }

    async setSaleFee(params: SetSaleFeeParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'setSaleFee',
            args: [params.hub, params.res, params.feeBp],
        });
        this.logger.info('submitting set sale fee', {
            trade: params.trade,
            hub: params.hub.toString(),
            res: params.res,
            feeBp: params.feeBp,
        });
        return this.contracts.send({ to: params.trade, data, value: null, gas: null }, TRADE_ABI);
    }

    async getSaleFee(params: GetSaleFeeParams): Promise<number> {
        const feeBp = await this.contracts.read<number>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getSaleFee',
            args: [params.hub, params.res],
        });
        return Number(feeBp);
    }

    async getLot(params: GetLotParams): Promise<OnChainLot> {
        return this.contracts.read<OnChainLot>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getLot',
            args: [params.lotId],
        });
    }

    async getLots(params: GetLotsParams): Promise<Array<OnChainLot>> {
        return this.contracts.read<Array<OnChainLot>>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getLots',
            args: [params.lotIds],
        });
    }

    async getConfig(params: GetTradeConfigParams): Promise<OnChainTradeConfig> {
        return this.contracts.read<OnChainTradeConfig>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getConfig',
            args: [],
        });
    }

    async getMinLotValue(params: LotBoundParams): Promise<bigint> {
        return this.contracts.read<bigint>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getMinLotValue',
            args: [params.hub, params.res],
        });
    }

    async getMaxLotValue(params: LotBoundParams): Promise<bigint> {
        return this.contracts.read<bigint>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getMaxLotValue',
            args: [params.hub, params.res],
        });
    }

    async getSellerLotCount(params: SellerLotCountParams): Promise<bigint> {
        return this.contracts.read<bigint>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getSellerLotCount',
            args: [params.seller, params.hub, params.res],
        });
    }

    async getSellerEvictedCount(params: SellerEvictedCountParams): Promise<bigint> {
        return this.contracts.read<bigint>({
            address: params.trade,
            abi: TRADE_ABI,
            functionName: 'getSellerEvictedCount',
            args: [params.seller, params.hub],
        });
    }

    async quoteReturn(params: QuoteReturnParams): Promise<ReturnQuoteResult> {
        try {
            return await this.contracts.read<ReturnQuoteResult>({
                address: params.trade,
                abi: TRADE_ABI,
                functionName: 'quoteReturn',
                args: [params.lotId, params.returnTokenIds, params.seller],
            });
        } catch (error) {
            throw namedQuoteRevert(error);
        }
    }

    async quoteSale(params: QuoteSaleParams): Promise<SaleQuoteResult> {
        try {
            return await this.contracts.read<SaleQuoteResult>({
                address: params.trade,
                abi: TRADE_ABI,
                functionName: 'quoteSale',
                args: [params.lotId, params.value, params.buyer],
            });
        } catch (error) {
            throw namedQuoteRevert(error);
        }
    }

    async quoteBuy(params: QuoteBuyParams): Promise<BuyQuoteResult> {
        try {
            return await this.contracts.read<BuyQuoteResult>({
                address: params.trade,
                abi: TRADE_ABI,
                functionName: 'quoteBuy',
                args: [params.lotId, params.value, params.destTokenIds, params.buyer],
            });
        } catch (error) {
            throw namedQuoteRevert(error);
        }
    }
}
