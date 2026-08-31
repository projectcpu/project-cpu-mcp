# The Cell marketplace

Cells are NFTs, and they trade on a public NFT marketplace for a currency the collection configures. This
server exposes that market as four reads and five complete actions. It is a different market from the in-game
resource trade: a **Cell listing** and a **Cell offer** are **Market orders**, settled by **Market
fulfilment**; a resource **Lot** is sold in **Fills**. Nothing here touches a Lot, and no Lot tool touches a
Market order.

## Startup

`NETWORK` accepts only `robinhood` (chain 4663), and `RPC_URL` overrides that network's public RPC. The server
supports the same two wallet modes for marketplace actions as it does for the rest of the game:

- **Paybox (default)** — `cpu_authenticate` opens browser authorization and selects an autonomous EVM wallet
  grant. Paybox signs transactions and EIP-712 marketplace orders remotely. Before an order is submitted, the
  server recovers its signer and requires it to match the selected wallet.
- **EVM** — set `WALLET_MODE=evm` and `PRIVATE_KEY=0x...`. SIWE, transactions and EIP-712 marketplace orders
  are signed locally.

**No OpenSea API key is required, and no environment variable accepts one.** Every marketplace request this
server makes goes to the authenticated game API, which mediates all OpenSea REST access. Marketplace calls are
therefore governed by your game-API session, not by any credential you hold for the marketplace itself.

## The nine tools

| Tool | What it does |
| --- | --- |
| `cpu_get_cell_market` | Best listing and best offer for one Cell. Each is independently `null` when there is none — that is an answer, not a failure. |
| `cpu_get_my_listings` | Your active Cell listings, one cursor page at a time. |
| `cpu_get_my_offers` | Cell offers you made. |
| `cpu_get_my_offers_received` | Cell offers other wallets made on your Cells. The makers are other people; they are not filtered out. |
| `cpu_list_cell` | Sell one Cell you own at a gross price, optionally reserved for one buyer. |
| `cpu_make_cell_offer` | Bid on one exact Cell you do not own. |
| `cpu_buy_cell` | Buy one exact listing, under a maximum you set. |
| `cpu_accept_cell_offer` | Sell one exact Cell into one exact offer. |
| `cpu_cancel_order` | Cancel one exact Market order you made — listing or offer, one action for both. |

Each of the five actions is one whole player intent. Preparing the order, sending any approval the wallet
still owes, signing typed data, submitting, broadcasting, waiting for receipts and verifying the result all
happen inside the single call. There is no prepare tool, no submit tool, no approval tool, no fulfilment tool
and no confirmation step — including no second call to confirm fees.

## Gross prices and fees

`cpu_list_cell` takes the **gross** price: the amount a buyer pays. Marketplace and creator fees come out of
that amount rather than being added to it. The result discloses the split — platform fee, creator fee and your
estimated proceeds — for the gross price you named. Calling the tool is your consent to that mandatory split;
there is no `minProceeds` input and no second confirmation.

## Exact-order safety

`cpu_buy_cell`, `cpu_accept_cell_offer` and `cpu_cancel_order` act on the `orderHash` you pass and on nothing
else. If that order has been filled, cancelled, expired or repriced past your ceiling, the call fails with
`ORDER_UNAVAILABLE` and moves no money. It never substitutes a cheaper, newer or otherwise preferable order,
and it never picks a different Cell — choosing a replacement is your decision, made with a fresh read.

A criteria offer (trait or collection) bids for a set of Cells and names none of them. Accepting one therefore
requires you to pass the `tokenId` you are willing to sell. Such an offer may stay active after your sale —
it can still buy other Cells — and that is not a failure and never a second sale of your Cell.

## Base-unit amounts and Unix-second times

Every monetary value crossing this surface is a **base unit** amount written as a decimal integer **string**:
`price`, `amount`, `maxAmount`, the fee components, and transaction values. Never a decimal fraction and never
a JSON number — a token amount can exceed what a double can hold exactly. The currency is reported alongside
with its address, symbol and decimals, so an agent can render the raw integer itself.

Every time value — `expirationTime`, order start and end times, prepared-intent deadlines — is a **Unix
second**, not milliseconds and not an ISO string.

Cell token ids are canonical decimal strings without leading zeroes: `"1234"`, never `"01234"`.

## Rate limits and waiting

The game API budgets marketplace traffic (roughly ten reads and five trading calls a minute per client). When
it throttles a call, the server waits inside the same tool call and retries — but only within one cumulative
**60-second automatic-wait budget per tool invocation**. That budget covers server-controlled retry and
reconciliation sleeps; wallet-signing latency is separate and cannot enlarge it. The budget is not reset by
another `429`, another network failure, another `5xx`, another authentication round or another prepared-intent
answer. The server checks the prepared order's deadline before signing and again before every submit attempt,
so a slow wallet signature is never submitted after expiry.

If the delay the API asks for is longer than the budget can cover, the call returns immediately with a
retryable error carrying `retryAfterSeconds`. Invoke the same tool again later.

Every marketplace error message carries a stable code, says plainly whether repeating the same call is safe,
names the stage that failed, includes `retryAfterSeconds` when it is known, and names any transaction that was
confirmed before the failure. Raw marketplace responses are never passed through.

## Duplicate safety and recovery

Duplicate protection is **process-local**: it lives in this running server and is deliberately discarded when
the process restarts. There is no journal on disk and no promise across restarts.

- Two identical calls made at the same time share one operation; they cannot publish two orders.
- An uncertain submit is retried with the **same** prepared intent and the same signature, so a lost HTTP
  response cannot create a second order.
- A repeat of an action that provably already happened is reported as `already_completed`, not as a failure.
- An active order of yours that matches the terms you asked for blocks a second one: the answer is
  `ACTIVE_ORDER_EXISTS`, and cancelling the active order first is the way to replace it deliberately.
- When an ambiguous creation cannot be reconciled because the game API is unavailable, the call returns
  `OUTCOME_UNKNOWN`, keeps its recovery record and refuses a fresh prepare for that intent. Availability is
  never traded for duplicate-order risk.
- Unresolved records are bounded at 100 for the whole process. None is ever evicted to admit a new write; at
  capacity, new marketplace writes are refused with a clear retryable capacity error instead.

## What this surface deliberately does not do

- It does not create trait or collection offers. Offers made here are item offers for one exact Cell.
- It does not pick a replacement order when the one you named becomes unusable.
- It does not enrich ordinary map or Cell reads with marketplace data, so a marketplace outage leaves ordinary
  gameplay alone.
- It does not talk to OpenSea directly, and it holds no marketplace credential.
