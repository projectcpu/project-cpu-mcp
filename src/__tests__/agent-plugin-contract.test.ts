import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'project-cpu');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
const CLAUDE_MANIFEST = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
const CODEX_MANIFEST = path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json');
const MARKETPLACE = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
const MCP = path.join(PLUGIN_ROOT, '.mcp.json');
const SKILL = path.join(PLUGIN_ROOT, 'skills', 'project-cpu', 'SKILL.md');
const README = path.join(REPO_ROOT, 'README.md');

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('the dual-harness plugin', () => {
    it('keeps both plugin manifests and the marketplace entry on the npm package version', () => {
        const marketplace = readJson(MARKETPLACE);
        const plugins = marketplace.plugins as Array<Record<string, unknown>>;

        expect(readJson(CLAUDE_MANIFEST).version).toBe(PACKAGE.version);
        expect(readJson(CODEX_MANIFEST).version).toBe(PACKAGE.version);
        expect(plugins.find((plugin) => plugin.name === 'project-cpu')?.version).toBe(PACKAGE.version);
    });

    it('uses one shared skill tree and MCP definition without a wallet secret', () => {
        const codex = readJson(CODEX_MANIFEST);
        const mcp = readJson(MCP);
        const serializedMcp = JSON.stringify(mcp).toLowerCase();

        expect(codex.skills).toBe('./skills');
        expect(codex.mcpServers).toBe('./.mcp.json');
        expect(fs.existsSync(SKILL)).toBe(true);
        expect(mcp).toEqual({
            mcpServers: {
                'project-cpu': {
                    command: 'npx',
                    args: ['-y', 'project-cpu-mcp@latest'],
                },
            },
        });
        expect(serializedMcp).not.toMatch(/private.?key|secret|mnemonic|wallet_mode/iu);
    });

    it('keeps independent extension points for the game pipelines', () => {
        const skill = fs.readFileSync(SKILL, 'utf8');

        expect(skill).toContain('references/funding.md');
        expect(skill).toContain('references/production.md');
        expect(skill).toContain('references/logistics.md');
        expect(skill).toContain('references/cell-market.md');
    });

    it('documents project-only and global setup without asking for wallet secrets', () => {
        const readme = fs.readFileSync(README, 'utf8');

        expect(readme).toContain('Agent setup');
        expect(readme).toMatch(/Claude Code[\s\S]*local[\s\S]*project[\s\S]*user/iu);
        expect(readme).toMatch(/Codex[\s\S]*global/iu);
        expect(readme).toMatch(/Codex[\s\S]*project-only/iu);
        expect(readme).toMatch(/Paybox[\s\S]*cpu_authenticate/iu);
        expect(readme).toMatch(/reload|new session/iu);
        expect(readme).toMatch(/project-only[\s\S]*recommend/iu);
    });
});
