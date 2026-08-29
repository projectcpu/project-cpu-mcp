---
name: project-cpu
description: Operate a Project CPU game session through its MCP server when an Operator asks to inspect or play the game.
---

# Project CPU

Start every session with `cpu_persona`, then call `cpu_authenticate`. Paybox opens browser authorization; never request wallet secrets in chat. Read `cpu_get_game_config` once, then read current `cpu_get_balance`, `cpu_get_map`, and `cpu_get_attention` before selecting work.

Use one loop for game work: observe, plan, quote or preflight, act, and verify. Re-read mutable state after a transaction or meaningful delay. Tool descriptions are authoritative for inputs, limits, outputs, and errors.

## Pipeline routes

- **Funding and reveal** — use `references/funding.md` when the goal needs ETH, $CPU, or wCPU; to acquire a Cell; or to reveal, fulfill, and verify a Cell.
- **Production** — use `references/production.md` for buildings, mining, or crafting.
- **Logistics and resource trade** — use `references/logistics.md` for route discovery, transport, delivery, warehouse capacity, or resource Lot buying, selling, Eviction, and recovery.
- **Cell Market** — use `references/cell-market.md` for Cell listings, offers, exact-order actions, and cancellations.

For resource Lots, use the trade tools and their quotes; they are separate from Cell Market NFT orders. Follow the Operator's requested objective and the host harness's authority rules.
