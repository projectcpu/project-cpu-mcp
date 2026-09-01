import type { ZodRawShape, ZodType } from 'zod';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { AppContext } from '../../../types.js';
import type { MarketToolDefinition } from '../types.js';

export interface ToolResult {
    content: Array<{ type: string; text: string }>;
    structuredContent: Record<string, unknown>;
}

export type CreateMarketTool = (context: AppContext) => MarketToolDefinition;

export interface CapturedTool {
    name: string;
    description: string;
    inputSchema: ZodRawShape;
    outputSchema: ZodType;
    handler: (args: never) => Promise<ToolResult>;
}

export function captureMarketTool(create: CreateMarketTool, contextPartial: Record<string, unknown>): CapturedTool {
    const context = { logger: new NoopLogger(), ...contextPartial } as unknown as AppContext;
    const definition = create(context);
    const validatedHandler = async (args: unknown): Promise<ToolResult> => {
        const result = await definition.handler(args);
        if (result.structuredContent === undefined) {
            throw new Error(`${definition.name} returned no structured content`);
        }
        definition.outputSchema.parse(result.structuredContent);
        return result as ToolResult;
    };

    return {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        handler: validatedHandler,
    };
}
