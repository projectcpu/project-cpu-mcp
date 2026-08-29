import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = path.join(REPO_ROOT, 'plugins', 'project-cpu', 'skills', 'operator-cpu', 'SKILL.md');
const FUNDING = path.join(REPO_ROOT, 'plugins', 'project-cpu', 'skills', 'operator-cpu', 'references', 'funding.md');

function readSkill(): string {
    return fs.readFileSync(SKILL, 'utf8');
}

function readFunding(): string {
    return fs.readFileSync(FUNDING, 'utf8');
}

describe('the funding and entry skill route', () => {
    it('establishes the persona-first world-read sequence before selecting work', () => {
        const skill = readSkill();

        expect(skill).toMatch(
            /cpu_persona[\s\S]*cpu_authenticate[\s\S]*cpu_get_game_config[\s\S]*cpu_get_balance[\s\S]*cpu_get_map[\s\S]*cpu_get_attention/iu,
        );
        expect(skill).toMatch(/observe[\s\S]*plan[\s\S]*(quote|preflight)[\s\S]*act[\s\S]*verify/iu);
        expect(skill).toMatch(/re-read mutable state[\s\S]*(transaction|delay)/iu);
    });

    it('chooses a viable funding path or reports the zero-asset blocker', () => {
        const reference = readFunding();

        expect(reference).toMatch(/ETH[\s\S]*cpu_quote_swap[\s\S]*cpu_swap/iu);
        expect(reference).toMatch(/wCPU[\s\S]*cpu_withdraw/iu);
        expect(reference).toMatch(/no ETH, wCPU, Cell, or saleable resources[\s\S]*blocker/iu);
    });

    it('acquires and reveals a Cell with preflight and fulfillment checks', () => {
        const reference = readFunding();

        expect(reference).toMatch(/cpu_quote_mint[\s\S]*cpu_mint_cell/iu);
        expect(reference).toMatch(/cpu_get_balance[\s\S]*cpu_reveal/iu);
        expect(reference).toMatch(/randomness[\s\S]*cpu_fulfill_reveal/iu);
        expect(reference).toMatch(/verify entry with[\s\S]*cpu_get_cell/iu);
    });

    it('defers tool schemas and preserves the Operator authority model', () => {
        const reference = readFunding();

        expect(reference).toMatch(/tool descriptions[\s\S]*(inputs|limits|errors)/iu);
        expect(reference).not.toMatch(/autonomous mode|advisory mode|confirmation mode/iu);
        expect(reference).not.toMatch(/ask.*approval|request.*approval/iu);
    });
});
