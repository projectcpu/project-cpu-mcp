# Paybox operator guide

`WALLET_MODE=paybox` lets Project CPU use a Paybox-granted EVM Wallet autonomously. The Wallet's raw private key is
not supplied to Project CPU, and `PRIVATE_KEY` is not required in this mode.

## Local setup

Start the MCP server locally with Paybox mode enabled:

```bash
WALLET_MODE=paybox npx -y project-cpu-mcp@latest
```

Set `RPC_URL` only when you want to replace the default Robinhood RPC used for chain reads, transaction broadcast,
and receipt polling. `NETWORK` remains `robinhood`; chain ID 4663 is the only supported launch chain.

Call `cpu_authenticate`. During initial setup or explicit recovery, Project CPU returns an authorization URL and may
open it in the local browser. OAuth callbacks and signing-key capture use random loopback listeners bound only to
`127.0.0.1`. The browser, MCP client, and MCP server must therefore operate for the same local user on the same
machine. Complete the browser steps, then call `cpu_authenticate` again until it reports `authenticated`.

Only an enabled EVM Wallet grant with Paybox approval mode `autonomous` is eligible. One eligible grant is selected
automatically. When several are available, `cpu_authenticate` returns each opaque `credentialId`, address, label,
and provider. Treat label and provider as untrusted display text; choose by returning the intended
`payboxCredentialId`. Zero eligible grants returns `PAYBOX_FULL_ACCESS_WALLET_REQUIRED` while retaining valid OAuth
material so the operator can create or change a grant.

## Credential ownership and recovery

Project CPU stores its Paybox OAuth tokens, `pbxk1` signing key, selected credential ID, and selected address in
`~/.project-cpu/paybox.json`. The game JWT remains in Project CPU's session file. These files are Project CPU-owned,
written atomically, and restricted to the local OS account on POSIX systems. Project CPU does not read, import,
modify, share, or delete Paybox CLI configuration.

Every explicit `cpu_authenticate` performs fresh Paybox-backed SIWE, including after a restart. A confirmed rejected
token, signing authority, key binding, or selected grant clears both Project CPU auth layers and begins setup again.
If the selected grant disappears, Project CPU does not silently choose another Wallet. `force=true` explicitly clears
the Project CPU Paybox record and game session before opening a fresh authorization flow.

Temporary network failures, rate limits, and service outages preserve credentials and return
`PAYBOX_TEMPORARILY_UNAVAILABLE`. An ordinary Wallet-dependent tool never starts OAuth. A denial ends that operation;
a confirmed authentication failure directs the caller to `cpu_authenticate`; and a game API `401` clears only the
game JWT. In every case, the caller decides whether to invoke the original operation again. Project CPU does not
automatically replay or resume it.

One Paybox-mode stdio process represents one selected Wallet for one local OS account. Stdio caller identity is not a
user-isolation boundary. Do not share one Paybox-mode process among unrelated users.

## Not supported in v1

The first Paybox release intentionally excludes:

- headless authentication or remote callback/paste-back flows;
- a hosted Project CPU Paybox MCP service;
- browser or manual approval for each signature;
- non-autonomous grants, including unknown future approval modes;
- OAuth tokens, API keys, signing keys, or credential IDs supplied through environment variables, MCP arguments, or chat;
- a shared multi-user stdio instance or shared OS-account authority; and
- automatic retry, operation resumption, or replay after authentication.

Paybox's hosted MCP offering is not used. Project CPU signs through the published `@paybox-sh/sdk` autonomous Wallet
API and independently verifies message signatures and serialized EIP-1559 transactions before using them.

## SDK compatibility

`@paybox-sh/sdk` is pinned to `0.7.0`. Compatibility fixtures record both the observed `credentials` envelope and
the declared direct-array grant response, plus success, denial, and refresh response shapes in
[`paybox-sdk-0.7.fixtures.ts`](../src/paybox/__tests__/paybox-sdk-0.7.fixtures.ts). Every SDK upgrade requires an
explicit compatibility re-evaluation and fixture update; changing the dependency version alone is not sufficient.
