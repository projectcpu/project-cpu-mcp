import type { OnboardingFacts, OnboardingStepBrief } from './types.js';
import {
    COMPLETE_ONBOARDING_STEP_TOOL_NAME,
    RESTART_ONBOARDING_TOOL_NAME,
    SKIP_ONBOARDING_TOOL_NAME,
} from '../../onboarding/constants.js';
import { OnboardingStep } from '../../onboarding/types.js';

export const ONBOARDING_TOOL_DESCRIPTION = [
    'Where the player stands in the six-step introduction to the game, and what to cover next. No input.',
    'Answers with the step (N/6) and its phase, whether the introduction is finished or was skipped, and the',
    'brief for the current step: the theses to cover, what closes the step and which tool closes it. Call it',
    'right after `cpu_authenticate` for a player you have not walked through yet, and again whenever you are',
    'unsure what they already know. The brief is a set of notes for you — put it in your own words, in the',
    'language of the player, and never read it out. The steps that are pure explanation — `intro`,',
    '`wallet_and_cell` and `tour` — are closed in the same turn they are delivered, with no confirmation',
    'asked of the player.',
].join(' ');

export const COMPLETE_ONBOARDING_STEP_TOOL_DESCRIPTION = [
    'Mark one step of the introduction as closed. Use it for the steps that are pure explanation — `intro`,',
    '`wallet_and_cell` and `tour` — once the player has actually had them, and for a step the player had',
    'already done before the introduction began: a cell already revealed, a building already standing, a job',
    'already running. Do not close a step whose action has not happened — `cpu_reveal`, `cpu_build` and',
    '`cpu_start_mining` close their own steps when the action succeeds. Close an explanation step in the same',
    'turn you delivered it, without asking the player for permission to go on. Closing the sixth step ends the',
    'introduction. Answers with the new state and the next brief.',
].join(' ');

export const SKIP_ONBOARDING_TOOL_DESCRIPTION = [
    'Close the whole introduction because the player asked to skip it. `playerRequest` carries their own',
    'words, quoted, and it must not be empty. Never call this on your own initiative: not because the',
    'introduction feels slow, not to unblock a tool that refused, not to save a few turns. Without an',
    'explicit request from the player this call is out of bounds. It closes all six steps with that reason',
    'and opens every game tool.',
].join(' ');

export const RESTART_ONBOARDING_TOOL_DESCRIPTION = [
    'Run the introduction again because the player asked for it. `playerRequest` carries their own words,',
    'quoted, and it must not be empty. Never call this on your own initiative — it resets the state to step 1',
    'and the game tools refuse again until `intro` is closed, so only an explicit request from the player',
    'justifies it.',
].join(' ');

const PACING_RULE = [
    'Never ask the player for permission to go on and never end on "say next": a step that is pure',
    `explanation you close at once with \`${COMPLETE_ONBOARDING_STEP_TOOL_NAME}\` and deliver the next brief in`,
    'the same reply. Hand the turn back only where the step needs something from the player — money to spend,',
    'a choice to make, a cell to move — and then name exactly that one thing at the end.',
].join(' ');

export const ONBOARDING_BRIEF_RULES: ReadonlyArray<string> = [
    'Four or five sentences at most per step, counted per step even when two steps share one reply.',
    'Only the terms this step needs; another mechanic only when the player asks about it.',
    PACING_RULE,
    'Your own words, in the language the player writes in — the theses are notes, never a text to read out.',
    'A step that spends real money runs only after the player has said yes to it.',
];

const GAME_LOOP_THESIS = [
    'the loop: mine the deposits, craft what they feed, forge wCPU in the CPU Forge, cash wCPU out 1:1 as',
    'onchain $CPU',
].join(' ');

const EMISSION_BUDGET_THESIS = [
    'the Emission budget — the onchain $CPU reserve those cash-outs draw on — is finite, and every reveal',
    'deepens the $CPU market',
].join(' ');

const CELL_SOURCES_THESIS = [
    'two roads to a first cell: a transfer from the own wallet of the player to the agent address, or a',
    'purchase — `cpu_buy_cell` on the land market, or `cpu_quote_mint` then `cpu_mint_cell` on the primary',
    'drop',
].join(' ');

const REVEAL_FUNDING_THESIS = [
    'the reveal that comes next is paid in ETH from the agent address, so check it with `cpu_get_balance`',
    'before promising anything',
].join(' ');

const EXTRACTOR_CATALOG_THESIS = [
    '`cpu_get_cell` names the deposits, `cpu_find_buildings` and `cpu_get_building` name the extractor that',
    'mines them',
].join(' ');

const MINING_SIZE_THESIS = [
    '`cpu_start_mining` books a fixed number of cycles and there is no cancel, so size it against the cycle',
    'length in `cpu_get_game_config` and the deposit in `cpu_get_cell`',
].join(' ');

const CLAIM_THESIS = [
    'claim is a mechanic, not a wait: the job banks on its own schedule and `cpu_claim_mining` collects',
    'whenever the player comes back',
].join(' ');

const WCPU_PATH_THESIS = [
    'the road out: raw output, then recipes with `cpu_craft`, then wCPU from the CPU Forge, then',
    '`cpu_withdraw` turning wCPU into onchain $CPU, 1:1',
].join(' ');

const NETWORK_THESIS = [
    'a holding is more than one cell: `cpu_transport` moves goods between cells, and hubs carry lots for',
    'trade — `cpu_list_lots`, `cpu_create_lot`',
].join(' ');

const SYNDICATE_THESIS = [
    'a Syndicate is an onchain alliance of land owners with shared fee terms; trading or shipping through the',
    'hub of a fellow member simply costs less, and that discount is the one reason worth naming',
].join(' ');

const REVEAL_CLOSES = [
    'a completed `cpu_reveal` closes it by itself; mark it by hand only when the cell was revealed before',
    'this walkthrough',
].join(' ');

export const ONBOARDING_STEP_BRIEFS: Record<OnboardingStep, OnboardingStepBrief> = {
    [OnboardingStep.Intro]: {
        explain: [
            'Project CPU is an onchain industrial game; land cells are NFTs and one cell is the whole entry ticket',
            'a cell hides its deposits until a reveal rolls them',
            GAME_LOOP_THESIS,
            EMISSION_BUDGET_THESIS,
            'this walkthrough can be skipped: one word from the player and it stops',
            'the wallet check comes right now, in this same reply, and not after a confirmation from the player',
        ],
        closes: [
            'at once — mark it and move straight into the wallet check in the same reply; nothing happens',
            'onchain and nothing is waited for',
        ].join(' '),
        nextTool: COMPLETE_ONBOARDING_STEP_TOOL_NAME,
    },
    [OnboardingStep.WalletAndCell]: {
        explain: [
            'this agent signs from its own wallet, which is not the main wallet of the player',
            'a cell has to sit on that agent address before the agent can do anything with it',
            'a cell carries its whole game state when it moves; ETH and $CPU on a wallet do not travel with it',
            CELL_SOURCES_THESIS,
            REVEAL_FUNDING_THESIS,
        ],
        closes: [
            'at once when a cell already sits on the agent address — the facts below count them: mark it and move',
            'on to the reveal in the same reply; otherwise the one thing for the player is to get a cell onto the',
            'agent address, and the turn ends there',
        ].join(' '),
        nextTool: COMPLETE_ONBOARDING_STEP_TOOL_NAME,
    },
    [OnboardingStep.Reveal]: {
        explain: [
            'a reveal rolls the deposits of one cell, and a cell without deposits produces nothing',
            'it is paid: ETH with the transaction plus gas; the first reveal of a cell burns no $CPU',
            'ask the player before sending it — `cpu_reveal` spends real money, so no reveal without a yes',
            'on some networks the draw lands a moment later; `cpu_get_cell` shows the deposits once it does',
        ],
        closes: REVEAL_CLOSES,
        nextTool: 'cpu_reveal',
    },
    [OnboardingStep.BuildExtractor]: {
        explain: [
            'an extractor is the building that pulls a deposit out of the ground',
            'a cell holds one building, so match the extractor to a deposit the cell actually holds',
            EXTRACTOR_CATALOG_THESIS,
            'building burns $CPU and takes time to finish: ask the player first, then wait out the construction',
        ],
        closes: 'a successful `cpu_build` closes it by itself; mark it by hand only when a building stands',
        nextTool: 'cpu_build',
    },
    [OnboardingStep.StartMining]: {
        explain: [
            'a finished extractor stands idle until a job is started on it',
            MINING_SIZE_THESIS,
            'a cycle takes hours: say roughly when the job ends instead of asking the player to sit and wait',
            'matured cycles are banked later with `cpu_claim_mining`, and nothing is lost by coming back late',
        ],
        closes: 'a successful `cpu_start_mining` closes it by itself; mark it by hand only when a job runs',
        nextTool: 'cpu_start_mining',
    },
    [OnboardingStep.Tour]: {
        explain: [
            CLAIM_THESIS,
            WCPU_PATH_THESIS,
            NETWORK_THESIS,
            SYNDICATE_THESIS,
            'end with an open door: any mechanic, in any depth, whenever the player asks',
        ],
        closes: 'at once — pure explanation: mark it in the same reply, and that mark ends the whole walkthrough',
        nextTool: COMPLETE_ONBOARDING_STEP_TOOL_NAME,
    },
};

export const EMPTY_ONBOARDING_FACTS: OnboardingFacts = { walletAddress: null, cellCount: null, walletMode: null };

export const ONBOARDING_STATUS_PREFIX = 'Onboarding:';
export const ONBOARDING_STATUS_SEPARATOR = ' · ';
export const ONBOARDING_STATUS_FINISHED = 'finished';
export const ONBOARDING_STATUS_SKIPPED = 'finished (skipped at the request of the player)';
export const ONBOARDING_STATUS_UNAVAILABLE = 'unavailable';
export const ONBOARDING_STATUS_NO_SESSION = 'no session yet';

export const ONBOARDING_RULES_HEADING = 'How to deliver this step:';
export const ONBOARDING_EXPLAIN_HEADING = 'Explain (theses, not sentences to reuse):';
export const ONBOARDING_CLOSES_LABEL = 'Closes:';
export const ONBOARDING_NEXT_TOOL_LABEL = 'Next tool:';
export const ONBOARDING_FACTS_HEADING = 'Facts you already hold:';
export const ONBOARDING_ADDRESS_LABEL = 'Agent wallet address';
export const ONBOARDING_CELLS_LABEL = 'Cells on that address';
export const ONBOARDING_WALLET_MODE_LABEL = 'Wallet mode';
export const ONBOARDING_UNKNOWN_FACT = 'unknown';
export const ONBOARDING_BULLET = '- ';
export const ONBOARDING_LINE_SEPARATOR = '\n';
export const ONBOARDING_SECTION_SEPARATOR = '\n\n';

export const ONBOARDING_SKIP_REMINDER = [
    'The player may stop this at any point. Only on their own explicit words, call',
    `\`${SKIP_ONBOARDING_TOOL_NAME}\` and quote them.`,
].join(' ');

export const ONBOARDING_FINISHED_TEXT = [
    'The introduction is over: no step is open and no reminder follows it.',
    `Run it again only when the player explicitly asks — \`${RESTART_ONBOARDING_TOOL_NAME}\`, quoting them.`,
].join(' ');

export const ONBOARDING_SKIPPED_TEXT = 'The player skipped the introduction.';

export const ONBOARDING_UNAVAILABLE_TEXT = [
    'The introduction is unavailable right now. Nothing is blocked: the player can play as usual, and you',
    'answer their questions from what you know about the game.',
].join(' ');

export const ONBOARDING_NO_SESSION_TEXT = [
    'No game session yet, and the introduction belongs to the wallet rather than to this client.',
    'Call `cpu_authenticate` first, then ask again.',
].join(' ');

export const ONBOARDING_STEP_CLOSED_PREFIX = 'Closed onboarding step';

export const ONBOARDING_SKIP_DONE_TEXT = [
    'Onboarding closed at the request of the player. Every game tool is open now and no onboarding reminder',
    'follows.',
].join(' ');

export const ONBOARDING_RESTART_DONE_TEXT = [
    'Onboarding restarted at the request of the player. It begins again at step 1, and the game tools refuse',
    'until `intro` is closed.',
].join(' ');
