import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import type { AppContext } from '../types.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS_DIR = path.join(REPO_ROOT, 'src', 'tools');
const SERVER_FILE = path.join(REPO_ROOT, 'src', 'server.ts');
const README_FILE = path.join(REPO_ROOT, 'README.md');

const REGISTRAR_EXPORT = /export function (register[A-Za-z0-9]*Tool)\s*\(/gu;
const TOOL_NAME = /cpu_[a-z_]+/gu;

const sdk = vi.hoisted(() => ({ tools: new Array<string>() }));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: class McpServerStub {
        registerTool(name: string): void {
            sdk.tools.push(name);
        }

        connect(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {},
}));

async function registeredNames(): Promise<Array<string>> {
    sdk.tools.length = 0;
    await createServer({ config: { OPERATOR_PERSONA: true } } as unknown as AppContext);
    return [...sdk.tools];
}

function sourceFiles(dir: string): Array<string> {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__' ? [] : sourceFiles(full);
        }
        return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });
}

function exportedRegistrars(): Array<string> {
    return [
        ...new Set(
            sourceFiles(TOOLS_DIR).flatMap((file) =>
                [...fs.readFileSync(file, 'utf8').matchAll(REGISTRAR_EXPORT)].map((match) => match[1] ?? ''),
            ),
        ),
    ];
}

describe('every tool module the repository ships', () => {
    it('is wired into the server, so a finished tool cannot sit unregistered behind a green suite', async () => {
        const server = fs.readFileSync(SERVER_FILE, 'utf8');
        const registrars = exportedRegistrars();
        const unwired = registrars.filter((name) => !server.includes(`${name}(registrar`));

        expect(registrars.length).toBeGreaterThan(0);
        expect(unwired).toEqual([]);
        expect(registrars.length).toBe((await registeredNames()).length);
    });
});

describe('the README shipped to npm', () => {
    it('catalogues exactly the tools the server registers', async () => {
        const readme = [...new Set(fs.readFileSync(README_FILE, 'utf8').match(TOOL_NAME) ?? [])];
        const registered = await registeredNames();

        expect(readme.filter((name) => !registered.includes(name))).toEqual([]);
        expect(registered.filter((name) => !readme.includes(name))).toEqual([]);
    });
});
