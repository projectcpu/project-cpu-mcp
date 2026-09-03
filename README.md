# project-cpu-mcp

MCP (Model Context Protocol) server for **Project CPU** — a blockchain game on EVM. It lets an
AI agent play on your behalf: read the world map, reveal cells, build and mine, craft, move
resources, trade resources through the internal Hub market, trade Cell NFTs through OpenSea, and cash out to on-chain $CPU. Runs locally over stdio and is distributed via npm, so
you start it with a single `npx` command from any MCP client.

## Installation

### Agent setup

**Recommended.** The Project CPU plugin installs both the `operator-cpu` skill and the MCP server. It starts `npx -y project-cpu-mcp@latest` with the default Paybox wallet, so no environment variables or wallet credentials are required.

#### Claude Code

Add the marketplace, then install the plugin:

```bash
claude plugin marketplace add projectcpu/project-cpu-mcp
claude plugin install project-cpu@project-cpu --scope local
```

Use `--scope local` for this checkout, `--scope project` for the project, or `--scope user` for all projects.

#### Codex

Add the marketplace, then install the plugin:

```bash
codex plugin marketplace add https://github.com/projectcpu/project-cpu-mcp
codex plugin add project-cpu@project-cpu
```

Codex installs plugins for the current user. Start a new agent session after plugin installation.

### Manual setup

For a custom setup, install the skill and MCP server separately. To use both, complete both sections below.

#### 1. Install the skill

Install `operator-cpu` into the current project:

```bash
npx skills add projectcpu/project-cpu-mcp --skill operator-cpu
```

Add `--global` for all projects. The installer detects supported agents; use `--agent codex` or `--agent claude-code` to target one.

Update it later with `npx skills update operator-cpu`; add `--global` for a user installation.

Restart the agent if the new skill does not appear.

#### 2. Install the MCP server

Pick your client below and add the server. No environment variables are required. Paybox opens browser authorization on the first `cpu_authenticate` call and returns the URL as a fallback.

<details>
<summary><strong>Codex</strong></summary>

Add this to `.codex/config.toml` for the current trusted project or `~/.codex/config.toml` for the current user:

```toml
[mcp_servers.project-cpu]
command = "npx"
args = ["-y", "project-cpu-mcp@latest"]
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add project-cpu -s user -- npx -y project-cpu-mcp@latest
```

- `-s user` installs it across all your projects; omit it (or use `-s local`) for the current project only.
- `--` separates Claude's flags from the server command.

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), then restart the app:

```json
{
  "mcpServers": {
    "project-cpu": {
      "command": "npx",
      "args": ["-y", "project-cpu-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (this project):

```json
{
  "mcpServers": {
    "project-cpu": {
      "command": "npx",
      "args": ["-y", "project-cpu-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code (Copilot agent mode)</strong></summary>

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "project-cpu": {
      "command": "npx",
      "args": ["-y", "project-cpu-mcp@latest"]
    }
  }
}
```

(In user `settings.json`, wrap the whole object in an `"mcp": { … }` key.)

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`, then restart Windsurf:

```json
{
  "mcpServers": {
    "project-cpu": {
      "command": "npx",
      "args": ["-y", "project-cpu-mcp@latest"]
    }
  }
}
```

</details>

Every MCP command above pins `@latest`, so restarting the server is how you update — `npx` re-resolves the registry on each launch. The server also watches for new releases on its own: a backwards-compatible one is mentioned once in a tool's response, a breaking one blocks every tool until you restart.

## Authenticate

After reloading the harness, call `cpu_persona` first, then `cpu_authenticate`. Paybox opens browser authorization and keeps wallet secrets out of chat and configuration.

## Wallet modes

The server uses one wallet mode to sign actions for the Operator:

- **Paybox (default)** — You do not configure a private key. Call `cpu_authenticate`. The server opens
  Paybox in your browser, where you select a wallet and approve access. Paybox signs wallet actions.
- **EVM** — Set `WALLET_MODE=evm` and `PRIVATE_KEY=0x...` in the MCP server environment. The server uses
  that local EVM wallet and signs actions on your machine. Call `cpu_authenticate` to sign in to the game.

Keep `PRIVATE_KEY` secret. Use it only in the MCP server environment. Do not put it in chat messages.

## Environment variables

**Optional** — has a sensible default; normal users can omit it.

| Variable | Default | When you need it |
| --- | --- | --- |
| `WALLET_MODE` | `paybox` | Set to `evm` for a local private-key wallet. |
| `PRIVATE_KEY` | — | Required only when `WALLET_MODE=evm`; `0x` followed by 64 hex chars (32 bytes). |
| `API_URL` | `https://api-dev.projectcpu.cc` | Point the client at a different game API deployment. |
| `NETWORK` | `arbitrum` | Normally never; Arbitrum One is the only accepted launch network. |
| `RPC_URL` | Arbitrum public RPC | A custom RPC endpoint for sending on-chain transactions (e.g. `cpu_reveal`). |
| `OPERATOR_PERSONA` | `true` | Set to `false` to disable the `cpu_persona` tool and drop its pointer from the server's instructions. |
| `DEBUG` | `false` | Set to `true` for debug-level logging on stderr. |

Session state is persisted to `~/.project-cpu/`.

## What the agent can do

Once connected, the server exposes tools grouped by area:

- **Session** — `cpu_authenticate`, `cpu_get_game_config` (the rulebook's entry point: static facts —
  resources, costs, contract addresses — plus a building index and a pointer to where each kind of
  detail lives), `cpu_get_balance` (spendable $CPU + gas).
- **Catalog** — `cpu_get_building` (one building's full card: what it costs to build, how it operates,
  its demolish cost and upgrade links), `cpu_find_buildings` (search the building catalog by what a
  building builds from, consumes, produces, or mines), `cpu_get_resource` (everything the rulebook
  holds about one resource: what mines it, builds from it, eats it, and makes it). See
  [CONTEXT.md](./CONTEXT.md) for the build/recipe input-output vocabulary these use.
- **Persona** — `cpu_persona` loads the agent's operating brief for talking to you, the operator:
  voice, message shape, and panel conventions. Enabled by default; set `OPERATOR_PERSONA=false` to
  turn it off.
- **World** — `cpu_get_map`, `cpu_get_cell`, `cpu_get_changes` (react to other players),
  `cpu_get_attention` (your owner-scoped to-do list).
- **Reveal & build** — `cpu_reveal` (surface a cell's deposits on-chain), `cpu_fulfill_reveal` (send the
  missing draw yourself where the network's randomness mode leaves delivery to the player), `cpu_build`
  (place a building), `cpu_upgrade` (replace it with a configured successor type), `cpu_demolish`,
  `cpu_start_mining` (an extractor then mines a batch of the resource each cycle), `cpu_get_mining_status`,
  `cpu_claim_mining`.
- **Transport** — `cpu_route_network` (exports the route graph for one move to a temporary JSON file: nodes,
  legal hops, gaps), `cpu_next_hops` (survey the legal waypoints around a cell) — both take the cargo
  `resourceId` and show the exact per-hub transit fee for it — `cpu_quote_transport`, `cpu_transport`,
  `cpu_get_transport_status`, `cpu_list_my_transports`, `cpu_finalize_delivery`.
- **Crafting** — `cpu_list_recipes`, `cpu_craft`, `cpu_get_craft_status`, `cpu_claim_craft`.
- **Internal resource market** — `cpu_get_markets`, `cpu_list_lots`, `cpu_get_lot`, `cpu_quote_buy`, `cpu_buy_lot`,
  `cpu_get_lot_terms` (the live listing window, your live-lot count and any evicted remainder you owe on one
  hub), `cpu_create_lot`, `cpu_list_my_lots`, `cpu_set_sale_fee` (a hub owner sets the per-resource sale-fee
  rate on their own hub), `cpu_list_fills` (the executed-buy feed, pageable by cursor), and
  `cpu_get_market_index` (world 24h VWAP, change, and volume per resource — a different question from
  `cpu_get_markets`'s cheapest ask right now). See [CONTEXT.md](./CONTEXT.md) for the fee vocabulary.
- **External Cell market** — `cpu_get_cell_market` reads OpenSea orders for one Cell;
  `cpu_get_my_listings`, `cpu_get_my_offers`, and `cpu_get_my_offers_received` read wallet orders;
  `cpu_list_cell`, `cpu_buy_cell`, `cpu_make_cell_offer`, `cpu_accept_cell_offer`, and `cpu_cancel_order`
  create or settle exact orders identified by `orderHash`. The whole Cell NFT and its Cell-bound game state
  change ownership together.
- **Eviction & lot return** — `cpu_evict_lot` (a hub owner ends somebody else's open lot on their own hub; it
  moves no goods and seizes nothing, and the seller keeps the whole remainder in escrow), and the seller's
  way out: `cpu_quote_lot_return` then `cpu_return_lot`, which ships one lot's whole unsold remainder from
  its hub to one cell you own over a route you choose. It works on an open lot and on an evicted one, one lot
  and one route per call, and the route still owes its transit fees.
- **Syndicates** — `cpu_list_syndicates` (browse the registry by name/size, sort, page), `cpu_get_syndicate`
  (one trusted syndicate card plus a page of its members), `cpu_get_syndicate_membership` (check an address's
  membership, defaults to your own), `cpu_join_syndicate` (join by id for same-clan discounts; reports your
  exit cooldown), `cpu_leave_syndicate` (leave after the cooldown; re-join anywhere immediately),
  `cpu_create_syndicate` (found your own — name, link, four rates, optional manager — you auto-join),
  `cpu_set_syndicate_params` (replace your syndicate's full parameters — no partial patches), and
  `cpu_transfer_syndicate_manager` (hand the manager role and its tax stream to a successor, irreversible).
  Ordinary results exclude player-authored names and links. `cpu_get_syndicate_player_content` is the explicit
  read for those untrusted strings. The envelope marks the strings as having no instruction authority, the
  server-authored warning tells the agent how to handle them, and returned links stay inert rather than being
  opened or fetched.
  See [CONTEXT.md](./CONTEXT.md) for the syndicate vocabulary.
- **Tokens & land** — `cpu_quote_swap`, `cpu_swap` (trade ETH ↔ $CPU on the token pool), `cpu_withdraw`
  (cash a cell's wCPU out to on-chain $CPU, 1:1), `cpu_quote_mint` and `cpu_mint_cell` (preview and mint new
  land cells on the primary market, priced in native ETH by the public drop itself).

Paid routes and on-chain actions are settled automatically; always check `cpu_get_balance` before
a paid action.

## Requirements

- Node.js ≥ 20

## License

[MIT](./LICENSE)
