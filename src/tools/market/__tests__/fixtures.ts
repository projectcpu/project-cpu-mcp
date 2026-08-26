import type { ZodRawShape } from 'zod';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import type { MarketToolDefinition } from '../types.js';

export interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

export type CreateMarketTool = (context: AppContext) => MarketToolDefinition;

export interface CapturedTool {
    name: string;
    description: string;
    inputSchema: ZodRawShape;
    handler: (args: never) => Promise<ToolResult>;
}

export function captureMarketTool(create: CreateMarketTool, contextPartial: Record<string, unknown>): CapturedTool {
    const context = { logger: new NoopLogger(), ...contextPartial } as unknown as AppContext;
    const definition = create(context);

    let captured: CapturedTool | null = null;
    const server = {
        registerTool(
            name: string,
            def: { description: string; inputSchema: ZodRawShape },
            handler: (args: never) => Promise<ToolResult>,
        ): void {
            captured = { name, description: def.description, inputSchema: def.inputSchema, handler };
        },
    } as unknown as ToolRegistrar;

    server.registerTool(
        definition.name,
        { description: definition.description, inputSchema: definition.inputSchema },
        definition.handler,
    );

    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}
