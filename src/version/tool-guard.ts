import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { NoticeBuffer, ToolGate } from './types.js';
import type { ToolHandler, ToolRegistrar } from '../tools/types.js';

export function createNoticeBuffer(): NoticeBuffer {
    let pending: Array<string> = [];
    return {
        take: (): Array<string> => {
            const taken = pending;
            pending = [];
            return taken;
        },
        keep: (notices: ReadonlyArray<string>): void => {
            pending = [...notices, ...pending];
        },
    };
}

export function guardToolHandler<TArgs extends Array<unknown>>(
    gates: ReadonlyArray<ToolGate>,
    handler: ToolHandler<TArgs>,
    buffer: NoticeBuffer,
): (...args: TArgs) => Promise<CallToolResult> {
    return async (...args: TArgs): Promise<CallToolResult> => {
        const collected: Array<string> = buffer.take();
        try {
            for (const gate of gates) {
                collected.push(...(await gate.check()));
            }
        } catch (error) {
            buffer.keep(collected);
            throw error;
        }
        const notices = [...new Set(collected)];

        let result: CallToolResult;
        try {
            result = await handler(...args);
        } catch (error) {
            buffer.keep(notices);
            throw error;
        }

        if (notices.length === 0) {
            return result;
        }

        return {
            ...result,
            content: [...(result.content ?? []), ...notices.map((text) => ({ type: 'text' as const, text }))],
        };
    };
}

export function createGuardedRegistrar(server: ToolRegistrar, gates: ReadonlyArray<ToolGate>): ToolRegistrar {
    const buffer = createNoticeBuffer();
    const registerTool: ToolRegistrar['registerTool'] = (name, config, callback) =>
        server.registerTool(
            name,
            config,
            guardToolHandler(gates, callback as unknown as ToolHandler, buffer) as unknown as typeof callback,
        );

    return { registerTool };
}
