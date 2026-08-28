# Paybox release checklist

Complete every item before releasing autonomous Paybox mode.

## Automated gate

- Confirm `@paybox-sh/sdk` remains exactly pinned to the version named by the compatibility fixtures.
- Run the public Paybox acceptance suite and the focused Paybox/tool suites.
- Run the complete repository gate with zero warnings:

  ```bash
  pnpm lint && pnpm build && pnpm typecheck && pnpm test
  ```

- Confirm the public acceptance ledger shows no duplicate authorization, signing, game API, broadcast, receipt, or
  replayed economic operations.
- Confirm documentation and source describe only published Paybox APIs and deployed chain behavior.

For every `@paybox-sh/sdk` upgrade, re-evaluate all published calls used here: explicit client construction, token
refresh, grant listing, autonomous message signing, and autonomous transaction signing. Compare real response shapes
with [`paybox-sdk-0.7.fixtures.ts`](../src/paybox/__tests__/paybox-sdk-0.7.fixtures.ts), update the versioned fixtures
and normalization tests, and rerun the full gate. Do not retain the old fixtures under a new dependency version.

## Mandatory live compatibility gate

Automated fakes and mocks do not satisfy this gate. Use real Paybox credentials and a real autonomous EVM Wallet
grant with authority to perform the chosen Robinhood transaction. Do not attempt the live gate when those credentials
and that authority are unavailable.

- Start a local `WALLET_MODE=paybox` instance without `PRIVATE_KEY` and complete the `127.0.0.1` browser bootstrap.
- Run a fresh `cpu_authenticate` and confirm Paybox signs the SIWE message autonomously and the game API accepts it.
- Invoke a controlled Wallet-dependent action that constructs and requests an EIP-1559 transaction for Robinhood
  chain ID 4663.
- Confirm Project CPU locally verifies the returned signer, type, destination, calldata, value, chain ID, gas, fee
  fields, nonce, and selected credential binding before broadcast.
- Confirm the locally verified serialized transaction is broadcast through the configured Robinhood RPC exactly once.
- Confirm the returned transaction hash receives a successful on-chain receipt on chain ID 4663.
- Record the SDK version, selected test action, transaction hash, receipt block, RPC endpoint category (default or
  override), and operator/date in the release evidence.

Any missing step, rejected SIWE, signing mismatch, failed broadcast, reverted/failed receipt, wrong chain, or absent
real authority blocks the release. Release Please remains responsible for version changes, changelog, tags, and npm
publishing after this checklist passes.
