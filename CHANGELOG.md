# Changelog

## [0.11.0](https://github.com/projectcpu/project-cpu-mcp/compare/v0.10.0...v0.11.0) (2026-08-29)


### ⚠ BREAKING CHANGES

* WALLET_MODE now defaults to paybox instead of evm.
* cpu_return_lot takes a new required input, `maxTransitFeeWei`. cpu_quote_lot_return's `transitPaid` is renamed to `maxTransitFee` and joined by `maxTransitFeeWei` — a quote debits nothing, it names a ceiling.

### Features

* default to Paybox and remove AGW wallet mode ([#22](https://github.com/projectcpu/project-cpu-mcp/issues/22)) ([b681747](https://github.com/projectcpu/project-cpu-mcp/commit/b681747e2d5533f1b724b4ad7c1a447e91e73285))
* evict foreign lots and return their remainders home ([0c47ba2](https://github.com/projectcpu/project-cpu-mcp/commit/0c47ba2868adbfb511a471acd77dc08a92578433))
* **plugin:** add operator-cpu game harness ([#26](https://github.com/projectcpu/project-cpu-mcp/issues/26)) ([ce0270c](https://github.com/projectcpu/project-cpu-mcp/commit/ce0270c081278c06329d6ca06a2b7ced36c1a3ec))


### Bug Fixes

* account for land metadata publication charge ([#18](https://github.com/projectcpu/project-cpu-mcp/issues/18)) ([6a5093a](https://github.com/projectcpu/project-cpu-mcp/commit/6a5093a5aab6d7ab65379409e85e54ec87dec68b))
* align mcp with current contract behavior ([#25](https://github.com/projectcpu/project-cpu-mcp/issues/25)) ([4c4d071](https://github.com/projectcpu/project-cpu-mcp/commit/4c4d071127b9f1bdee9e01753a954b96971f3bfb))
* guide reveal CPU shortfalls ([#21](https://github.com/projectcpu/project-cpu-mcp/issues/21)) ([8b1b293](https://github.com/projectcpu/project-cpu-mcp/commit/8b1b2936d3af1a83ea13480380485b36786317f2))
* stop double-counting reserved warehouse space ([#23](https://github.com/projectcpu/project-cpu-mcp/issues/23)) ([69c204a](https://github.com/projectcpu/project-cpu-mcp/commit/69c204a9dab0d1d9647e786fd0dc01a8a289566f))

## [0.10.0](https://github.com/projectcpu/project-cpu-mcp/compare/v0.9.1...v0.10.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* cpu_next_hops no longer returns the unread reach wrapper; per-cell reach is fromRadius and radius.
* server-side operator persona, context-lean entry point and panel output ([#15](https://github.com/projectcpu/project-cpu-mcp/issues/15))
* pin runtime to Robinhood, adopt explicit Cell and Hub storage shelves, and isolate syndicate player-authored fields behind a dedicated tool.

### Features

* route over Virgin cells on the GP54 world ([#16](https://github.com/projectcpu/project-cpu-mcp/issues/16)) ([7443f7e](https://github.com/projectcpu/project-cpu-mcp/commit/7443f7e262dd5b309e6929186411dc14a45992ea))
* server-side operator persona, context-lean entry point and panel output ([#15](https://github.com/projectcpu/project-cpu-mcp/issues/15)) ([b9327f1](https://github.com/projectcpu/project-cpu-mcp/commit/b9327f150ca7a4bf8d7ebaade6166e1d175493d9))
* sync launch API and contract surfaces ([#12](https://github.com/projectcpu/project-cpu-mcp/issues/12)) ([a5ad7a2](https://github.com/projectcpu/project-cpu-mcp/commit/a5ad7a2fc91aca9eda93329393e6930923c52b7b))


### Bug Fixes

* sync future contract compatibility ([e11d173](https://github.com/projectcpu/project-cpu-mcp/commit/e11d173da7759f22e5c5574fb80dc313fa299d8e))

## [0.9.1](https://github.com/projectcpu/project-cpu-mcp/compare/v0.9.0...v0.9.1) (2026-08-12)


### Features

* **harness:** support Codex worktree lifecycle ([1fac56c](https://github.com/projectcpu/project-cpu-mcp/commit/1fac56c456c1cf9aa6748bd2d5930473fb5d4a55))

## [0.9.0](https://github.com/projectcpu/project-cpu-mcp/compare/v0.8.1...v0.9.0) (2026-08-12)


### ⚠ BREAKING CHANGES

* the config `reveal` block is now `{ethContribution, cpuBurn}` and a reveal result reports `cpuBurn`, not `reRevealCost`. No reveal is free.

### Features

* add cpu_upgrade and surface the upgrade graph in cpu_get_game_config ([#7](https://github.com/projectcpu/project-cpu-mcp/issues/7)) ([7d04e7b](https://github.com/projectcpu/project-cpu-mcp/commit/7d04e7bca931762e13799e2dc7e7d420ab3acfff))
* pay every reveal from the cell's own quote ([#9](https://github.com/projectcpu/project-cpu-mcp/issues/9)) ([12084c6](https://github.com/projectcpu/project-cpu-mcp/commit/12084c62cfd817fec5f9017e276028d4cb8909f0))

## [0.8.1](https://github.com/projectcpu/project-cpu-mcp/compare/v0.8.0...v0.8.1) (2026-08-08)


### Bug Fixes

* resolve the Universal Router version each chain actually has deployed ([#5](https://github.com/projectcpu/project-cpu-mcp/issues/5)) ([b2fd54f](https://github.com/projectcpu/project-cpu-mcp/commit/b2fd54fe2999ef2b213d1cb4265f3eecf7e963ba))

## [0.8.0](https://github.com/projectcpu/project-cpu-mcp/compare/v0.7.1...v0.8.0) (2026-08-07)


### ⚠ BREAKING CHANGES

* read $CPU prices at the API's scale and add the executed-fill feed

### Features

* read $CPU prices at the API's scale and add the executed-fill feed ([2732574](https://github.com/projectcpu/project-cpu-mcp/commit/27325745b63e0962544baa9f7b134267cfb34fda))
* surface what is being demolished and when the demolition started ([#2](https://github.com/projectcpu/project-cpu-mcp/issues/2)) ([ea40030](https://github.com/projectcpu/project-cpu-mcp/commit/ea40030dca385fa1a9b315330aa6b7c905417b48))

## [0.7.1](https://github.com/projectcpu/project-cpu-mcp/compare/v0.7.0...v0.7.1) (2026-07-29)


### Bug Fixes

* default to the projectcpu.cc API host and the robinhood chain ([949ee18](https://github.com/projectcpu/project-cpu-mcp/commit/949ee1824e8ca90b1e79478fbf1746921c3465f3))
