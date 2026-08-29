# Cell Market orders

Cell Market orders trade Cell NFTs. Resource Lots, Fills, Hub escrow, and Lot return belong to resource trade; a Cell Market order uses none of those flows. Read the relevant Market view before each decision. Tool descriptions and returned data define inputs, limits, fees, and current order state.

Treat an order hash with its side, Cell, maker, price or amount, currency, expiry, and active state as one identity. A changed value requires a fresh decision. Capture the selected identity before an action, then verify the resulting ownership or order state.

## List a Cell

1. Read `cpu_get_map` and confirm the Cell belongs to the authenticated player. Use `cpu_get_my_listings` to inspect active listings and avoid a duplicate sale plan.
2. Set the sale terms after reviewing the gross price, mandatory fee split, expiry, buyer restriction, and Cell ownership. Defer value formats and limits to the tool description.
3. Call `cpu_list_cell` for the chosen Cell and terms. Record the returned Market order identity and transaction state.
4. Re-read `cpu_get_my_listings`. Confirm the selected Cell, price, expiry, fee result, and active order identity match the intended listing.

## Make a Cell offer

1. Read `cpu_get_cell_market` for the chosen Cell. Review its ownership, current listing or offer state, bid amount, currency, fee consequences, and expiry before setting an offer.
2. Call `cpu_make_cell_offer` for that Cell. Record the returned Market order identity and transaction state.
3. Re-read `cpu_get_my_offers`. Confirm the active offer matches the selected Cell, amount, currency, expiry, and order identity.

## Buy an exact listing

1. Read `cpu_get_cell_market` and select one active listing. Record its order hash with the Cell, seller, currency, price, expiry, and fee or balance consequences.
2. Re-read `cpu_get_cell_market` before purchase. Match the intended order hash and every decision-bearing value. Stop and re-plan if the listing changed, expired, or disappeared.
3. Call `cpu_buy_cell` for that exact listing. Keep the selected order identity bound to the action.
4. Re-read `cpu_get_map` and the Market state. Confirm the buyer owns the selected Cell and the selected order no longer remains active.

## Accept an exact offer

1. Read `cpu_get_my_offers_received` and select one active offer. Record its order hash, maker, offered amount, currency, expiry, offer kind, and the Cell intended for sale.
2. Re-read `cpu_get_my_offers_received` before acceptance. Match the intended order identity and confirm ownership of the selected Cell. Stop and re-plan if the offer changed, expired, or disappeared.
3. Call `cpu_accept_cell_offer` for that exact offer and Cell. Keep the selected order identity bound to the action.
4. Re-read `cpu_get_map` and `cpu_get_my_offers_received`. Confirm ownership changed for the selected Cell and inspect the selected offer's resulting state.

## Cancel an exact Market order

1. For a listing, read `cpu_get_my_listings`. For an offer, read `cpu_get_my_offers`. Select one active order made by the authenticated player.
2. Re-read the exact selected order from `cpu_get_my_listings` or `cpu_get_my_offers` before cancellation. Match its order hash, side, Cell, maker, amount or price, currency, expiry, and active state.
3. Call `cpu_cancel_order` for that exact Market order. A Cell listing and a Cell offer share this cancellation action; resource Lots use their own return flow.
4. Re-read the same owner view. Confirm the selected order no longer has an active state and record the cancellation result.
