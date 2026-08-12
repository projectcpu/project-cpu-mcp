# Project CPU MCP Server

MCP server for a blockchain game on EVM (Abstract). Distributed via npm, runs locally via `npx`.

Two wallet modes via `WALLET_MODE` (defaults to `evm`): `evm` (private key in env, SIWE auth — requires `PRIVATE_KEY`) or `agw` (Device Authorization flow). Session state persists to `~/.project-cpu/session.json`.

The target chain is chosen by `NETWORK` (optional, default `robinhood`; one of `ethereum | ethereum_sepolia | base | base_sepolia | robinhood`) — its chainId is routed locally (`src/config/network.utils.ts`) and contract addresses are loaded from the game API `GET /api/v1/config?network=`. Set `RPC_URL` when sending transactions (e.g. `reveal`); it falls back to the chain's public RPC otherwise.

## Worktrees

**ALWAYS work in a worktree for ANY change — no exceptions.** The moment a task will touch a file
(code, config, workflow, docs, secrets — anything that gets committed), the FIRST action is to create
a worktree. The main checkout stays on `main` as a read-only hub; **never edit, branch, or commit in
it.** "It's a small/interactive/one-off change" is NOT an exception — every change goes through a
worktree. Read-only work (exploring, answering questions, running tests/builds) may stay in the hub.

Branches: `<type>/<kebab-slug>`, type — conventional-commit (`feat` `fix` `chore` `refactor` `test`
`docs` `perf` `ci` `build` `revert`); defaults to `feat` when no type is given.

- **YOU MUST** create or re-enter worktrees with
  `bash tools/harness/worktree-create.sh --name <type>/<slug> [--source PATH]`. The command branches
  off the hub, copies local-only files, installs dependencies, and prints the absolute worktree path
  on stdout. Use that returned path as the working directory for every subsequent mutation. A name
  without a type becomes `feat/<slug>`. Never use `git worktree add` directly and never create a
  branch in the hub — both bypass the repository lifecycle.
- Worktrees live in the sibling `../mcp-worktrees/<branch-slug>` directory.
- A new local-only (gitignored) file a worktree needs → add its path to `ENV_FILES` in
  `tools/harness/worktree-create.sh`.
- Remove a worktree with
  `bash tools/harness/worktree-cleanup.sh --target PATH [--source PATH]`. Cleanup preserves local and
  unmerged work and keeps the branch by default. Use `--discard-changes` only after an explicit
  decision to destroy detected work, and use the independent `--delete-branch` flag only after an
  explicit decision to remove the branch. Never finish cleanup with hand-written recursive deletion.

Local specs, tickets, handoffs, investigation artifacts, and working notes belong under the main
checkout's root `scratch/` directory. Keep them untracked; never put them in `docs/`, `.scratch/`, or a
linked worktree's own `scratch/` directory.

## Structure

```
src/
├── index.ts          # Entry — bootstraps AppContext, connects stdio
├── server.ts         # McpServer setup, tool registration
├── tools/            # MCP controllers (input → service → output)
├── services/         # Business logic, orchestration
├── wallet/           # WalletManager interface + EVM / AGW impls
├── api/              # ApiClient (HTTP to the game API, JWT bearer + SIWE re-login)
├── session/          # SessionStorage + SessionManager (persist JWT / session keys)
└── config/           # env + constants
```

## Code rules

### Separate types, constants, and helpers from implementation

Class, service, and factory files contain **only** their runtime logic. Everything else lives in its own sibling file:

- `types.ts` — interfaces, type aliases, enums, zod schemas
- `constants.ts` — constants and magic numbers (module-scoped)
- `*.utils.ts` / `*.helpers.ts` — pure helper / utility functions

Global / cross-module constants live in `src/config/constants.ts`.

Example layout:
```
session/
├── types.ts        # SessionStatus, SessionData, ISessionStorage, schemas
├── constants.ts    # SESSION_FILE_MODE, SESSION_DIR_MODE
├── manager.ts      # SessionManager class
├── storage.ts      # SessionStorage class
└── jwt.utils.ts    # decodeJwtPayload(), isJwtExpired() — pure helpers
```

Test helpers (mocks, fixtures) stay inline inside `__tests__/`.

### Nullable over optional

Declare `field: T | null` in interfaces and type aliases. The `no-restricted-syntax` ESLint rule rejects `field?: T`. For external data shapes (JWT payload, third-party responses), add an inline `// eslint-disable-next-line no-restricted-syntax` on the offending line.

For zod schemas, use `.nullable()` instead of `.optional()`. Normalize `undefined` inputs to `null` at the edge: `schema.parse({ FOO: env.FOO ?? null })`.

### Enums

Use TypeScript `enum` for named domain values, never string-literal unions. For zod: `z.nativeEnum(MyEnum)`.

### Dependency inversion

Constructors accept interfaces (`ISessionStorage`, `WalletManager`). Tests substitute in-memory implementations.

### Errors

Services throw. The MCP SDK catches at the tool boundary and returns `{ isError: true }` automatically. Add `try/catch` inside a tool only when you need to rewrite the error message.

### Comments

Comments explain **why**, not **how** or **what**. The code already says what it does; a comment that restates it is noise and rots. Reserve comments for the non-obvious: a rationale, a trade-off, a footgun, an invariant, a unit/edge-case the types can't express. If a comment just paraphrases the next line, delete it.

This is a **public repository**. Do not reference private/internal infrastructure (server internals, backend services, internal package names, hostnames) in code or comments — keep the source self-contained.

In particular, **never mention the backend or its source** anywhere in code, comments, ABIs, or docs — no file paths, module/enum names, package names (e.g. internal `@…/shared` packages), service names, or "copied/mirrors from `<backend file>`" notes. Describe things only in terms of the public API surface this client consumes (HTTP routes like `GET /api/v1/config`, on-chain contracts/ABIs, env vars). When copying an artifact such as a contract ABI, document only what it is and that it must match the deployed contract — never where it came from. The generic notion of "the game API" / "the server" the client talks to (and the `API_URL` env var) is fine; pointers into a separate backend repo are not.

### Logging

Use the `Logger` from `src/logger/` — do not call `process.stderr.write` directly and do not use `console.log` (banned by ESLint). stdio belongs to MCP JSON-RPC, so logs must stay on stderr.

```typescript
import { rootLogger } from './logger/index.js';

const logger = rootLogger.child('session');
logger.info('loaded session', { address });
logger.error('save failed', { error });
```

The logger redacts sensitive fields automatically (`privateKey`, `jwt`, `mnemonic`, raw `0x`-hex private keys, JWT tokens) in both messages and meta. If a new sensitive key is introduced, extend `SENSITIVE_KEYS` in `src/logger/constants.ts`.

## Conventions

- Files: `kebab-case` with suffixes like `.service.ts`, `.manager.ts`, `.utils.ts`
- Imports: keep the `.js` extension (NodeNext module resolution)
- Tooling configs (`.eslintrc`, `.prettierrc`): use the `.cjs` extension — the package is `"type": "module"`

## Testing

Use `.integration.test.ts` when a test touches real filesystem or network; plain `.test.ts` for pure logic.

Integration tests isolate state with `fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'))` and clean up in `afterEach`. Never touch `os.homedir()`.

Reference: `src/session/__tests__/`.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck         # type-check including test files (tsconfig.eslint.json)
pnpm test              # all tests
pnpm test:unit         # unit only (skips *.integration.test.ts)
pnpm lint              # zero warnings expected
pnpm lint:fix
pnpm format
```

Run `pnpm lint && pnpm build && pnpm typecheck && pnpm test` before every commit.

## Releasing

Releases are automated with **release-please** — never run `pnpm version`, hand-edit the `version` field in `package.json`/`.release-please-manifest.json`, or push `v*` tags yourself. release-please owns all of that.

Flow: land work as Conventional Commit PRs and **squash-merge** into `main` (the squash subject — the PR title — is the conventional commit release-please reads). From the commits on `main`, release-please keeps a **Release PR** open that bumps the version and updates `CHANGELOG.md`; **merging that Release PR** tags `v<version>` and publishes to npm. The merge of the Release PR is the release gate.

The bump is derived from the commits, mapped to the **public surface** (the MCP tools, their inputs/outputs, env vars, supported networks) — not the diff size:

- `fix:` → **patch** — backwards-compatible bug fix or internal change with no change to tool behaviour, inputs, or outputs.
- `feat:` → **minor** — backwards-compatible new capability: a new tool, a new **optional** input, a new env var with a default, an additive output field.
- `feat!:` / `BREAKING CHANGE:` → **major** — breaking change: removing/renaming a tool, making an input required or changing its type, changing an output shape consumers depend on, dropping a network/env var.

Pre-1.0: `release-please-config.json` sets `bump-minor-pre-major` + `bump-patch-for-minor-pre-major`, so while on `0.x` a breaking change bumps the **minor** and a feature bumps the **patch** (`0.x` is treated as unstable). Call the break out explicitly in the commit body.

To force a release the commits wouldn't trigger on their own (e.g. a docs-only change), add a `Release-As: x.y.z` footer to a commit on `main` (land it via a small PR) — release-please then opens a Release PR for that exact version. Never create the tag by hand: a stray tag desyncs release-please's manifest/release bookkeeping.

Publishing runs in `.github/workflows/release.yml`: on push to `main`, release-please opens/updates the Release PR; when the Release PR merges, the **same run** tags the release and a gated `publish` job re-runs lint/typecheck/build/unit tests and runs `npm publish --provenance` (OIDC trusted publishing). The npm trusted publisher is bound to this workflow's filename (`release.yml`) — renaming the file requires updating it on npmjs.com. End users get it via `npx project-cpu-mcp@latest`.

## Git

Omit the `Co-Authored-By: Claude ...` trailer from commit messages.

Omit the `🤖 Generated with Claude Code` line (and any equivalent "generated by" attribution) from pull request descriptions.

Keep commit messages short: a single subject line capturing the essence. Add a body only when something genuinely needs explaining.
