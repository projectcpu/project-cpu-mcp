import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const README = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

const PROJECT_SCOPED_DEFAULTS: ReadonlyArray<[string, string]> = [
    ['the Claude Code plugin', 'plugin install project-cpu@project-cpu --scope local'],
    ['the Claude Code server', 'claude mcp add project-cpu -s local'],
    ['the skill installer', 'npx skills add projectcpu/project-cpu-mcp --skill operator-cpu\n'],
    ['VS Code', 'Create `.vscode/mcp.json`'],
];

describe('the install commands the README hands an agent', () => {
    it.each(PROJECT_SCOPED_DEFAULTS)('offers no project-scoped default for %s', (_client, command) => {
        expect(README).not.toContain(command);
    });

    it('installs the Claude Code plugin and server for the whole user', () => {
        expect(README).toContain('plugin install project-cpu@project-cpu --scope user');
        expect(README).toContain('claude mcp add project-cpu -s user');
    });

    it('installs the skill for the whole user', () => {
        expect(README).toContain('npx skills add projectcpu/project-cpu-mcp --skill operator-cpu --global');
    });

    it('points every file-edited client at the user-level file', () => {
        expect(README).toContain('~/.codex/config.toml');
        expect(README).toContain('~/.cursor/mcp.json');
        expect(README).toContain('user `settings.json`');
    });

    it('tells an agent to install at user scope without asking', () => {
        expect(README).toContain(
            'Install at user scope unless the user explicitly asked for a project install. Do not ask.',
        );
    });
});

describe('the environment table', () => {
    it('carries the onboarding switch with its default', () => {
        expect(README).toMatch(/\|\s*`OPERATOR_ONBOARDING`\s*\|\s*`true`\s*\|/u);
    });
});
