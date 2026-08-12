# Changelog

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
