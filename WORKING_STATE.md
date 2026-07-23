# Confirmed Working State

Date: 2026-07-22

Robinhood Chain buy completed successfully after these fixes:

- Uniswap V3 pool token addresses are sorted before `Factory.getPool` calls.
- Direct pools use their known address and fee; empty pools are filtered from Trenches.
- Routing can bridge through WETH or USDG without creating a `WETH -> WETH` leg.
- GMGN token extraction prioritizes `/robinhood/token/<address>` and rejects infrastructure addresses.
- All Robinhood buys use native ETH and send it as `msg.value` to the payable router call. `SwapRouter02` wraps ETH to WETH inside the swap callback. A USDG wallet balance must never switch a buy back to a USDG/token route.
- Input token balance is checked before swap submission.
- `simulateContract` runs before `exactInputSingle` or `exactInput` is submitted.

Do not select USDG as the input for Robinhood buys. New tokens commonly have a WETH pool but no USDG pool; selecting USDG caused `No swap route found` or a router `transferFrom` revert.

The native-buy rule is enforced in `src/background.ts`, not only in UI callers. Every `TRENCH_EVM_TRADE` buy uses native ETH even if a stale or future caller passes `inputCurrency: 'USDG'` or `'WETH'`.

Trenches checks the background runtime on load and before BUY. An invalidated extension context reloads the Trenches page before any transaction is submitted. If the context changes after submission, the page stays open and tells the user to check wallet activity before retrying; the trade is never repeated automatically.

Robinhood buys first try the existing Uniswap V3 route. If no WETH/token V3 pool exists, background checks the Virtuals pair factory and uses the verified payable aggregator route `WETH -> VIRTUAL -> bonding token` in one transaction. EVM trades log ISO timestamps, elapsed milliseconds, route discovery, simulation, send, and receipt stages in the extension service worker console.

Doppler Uniswap V4 tokens are detected generically with one read-only `DopplerHookInitializer.getState(token)` call, executed in parallel with V3 discovery. Do not add per-token address branches for new Doppler launches. An active state with WETH as numeraire supplies the verified `PoolKey`; background then quotes through the V4 quoter and simulates one payable custom-router swap before submission.

`0xc984e7a2f7b5e8a4a37f9cd00d374bc9dd44bba3` is `FREED / Freedhood`. It is a Doppler V4 token with fee flag `8388608`, tick spacing `200`, and hook `0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544`. The previous `No swap route found` was caused by the Doppler route being hard-coded only for `PULL`.

`0x43a74ecf28607bfa8edc40e7a8e83f6456ac42fd` is `IF / what IF`, launched through Pons. Its WETH V3 1% pool can report zero active `liquidity()` at the current boundary tick while a payable swap remains executable by crossing the next initialized tick. Pool existence is therefore retained through discovery and the mandatory router simulation is the authority for executability. Do not reject a registered V3 pool only because its instantaneous active liquidity is zero.

On 2026-07-18, the exact IF route was found in all three discovery runs. The direct read-only quote plus payable router simulation for `0.00001 ETH` completed successfully in `231` ms. No transaction was sent.

Do not restore a separate ETH `deposit` and WETH `approve` before native buys. Verified router transactions use one payable `exactInputSingle` call with `tokenIn = WETH`, `amountIn = msg.value`, and no prior wrap or approval. The extra transactions caused the approximately five-second delay.

## Route discovery snapshot

Read-only discovery checks Uniswap V3 fee tiers `100`, `500`, `3000`, and `10000` against WETH, USDG, and VIRTUAL, the Virtuals pair factory, and Doppler V4 initializer state.

- `0x552b9689488d8ae82f733d10e2ff7ea5dd3ba2b8` is `AROUNSHARK / Around Shark`, not the supplied `Pons` label. Its confirmed route is WETH V3 at 1% through pool `0x676b4f9ef1fdb83d60e456066f620fb37480a917`.
- `0x0152fa93e3dc19f8b71693fb797ce232d064812c` is `APEMAN`. Its confirmed route is WETH V3 at 1% through pool `0xb6f4f0581dc7eed25aad7530a12c96d2cd9d1484`.
- `0x342a2e3fe8b3f70189216910d936316294df7777` is `UFC / Ultimate Fighting Clankers`, not the supplied `Flap` label. No route was found in the checked V3 or Virtuals factories.
- `0x693d17bd4fc192415f7678548ae3c807873f7857` is `DART / Dart Finance`, not the supplied `Klick` label. No route was found in the checked V3 or Virtuals factories.
- `0x3a7059cc8ea61aaa5418405f509ad32a9a780ba3` is `PULL / pulldotfun by Virtuals`, not the supplied `Bankr` label. No pair was registered in the checked Virtuals factory and no checked V3 pool was found.
- `0xc984e7a2f7b5e8a4a37f9cd00d374bc9dd44bba3` is `FREED / Freedhood`. Its confirmed route is native ETH through the generic Doppler V4 WETH pool key and custom payable router.
- `0x43a74ecf28607bfa8edc40e7a8e83f6456ac42fd` is `IF / what IF`. Its confirmed route is native ETH through WETH V3 at 1% in pool `0xa7956100d35a86f0a389e6af607bc9459acfc124`.

Do not infer a platform from token naming or bytecode. Classification must come from a verified factory, initializer, or registry read.

Run `npm run benchmark:rh-routes` to repeat the read-only matrix. On 2026-07-18, Doppler `getState(FREED)` took `196.3`, `124.3`, and `200.8` ms. The six-token full fan-out took `516.7` ms cold, then `391.0` and `433.3` ms warm. The isolated FREED quote plus final router simulation completed in `236` ms. Treat 0.5 seconds as a warm-path target, not a strict cold-network SLA.

Run `npm test` for the pure Doppler classification regression and `node scripts/simulate-robinhood-buys.mjs` for read-only quote/router simulations. No script sends a transaction.

## GMGN overlay controls

- The floating Shadow DOM widget stops `pointerdown` and `click` propagation at its outer boundary. GMGN document-level outside-click handlers therefore do not close the token view when a Trench control is used.
- `TradeSettings.showOnGmgn` is the persisted master switch. The page-level `Trench On/Off` pill remains available while hidden; `Off` unmounts the trading overlay and removes injected controls, hotkeys, observers, intervals, and route listeners owned by the enabled UI.
- The content controller mounts on GMGN and follows SPA transitions. Robinhood controls are removed on another chain and reinjected with their stylesheet when returning to Robinhood.
- Every injected GMGN card has an ETH amount selector beside `BUY`. It reads and writes the existing `TradeSettings.selectedBuyAmount`; no second quick-buy setting exists.
- Injected controls use normal document flow with an auto margin instead of an absolute top-right layer, so market cap, volume, and card metrics remain unobstructed.
- Amount changes synchronize across all GMGN card selectors and the floating overlay. The four options continue to come from `TradeSettings.buyAmounts`.
- Buy and sell presets are edited as four independent numeric fields in the overlay and Options. Legacy short arrays are filled to four values, and selected values are kept inside the visible preset set.
- EVM buys ping the extension background before trade submission. An invalid context reloads before sending; if messaging is invalidated after submission starts, the UI tells the user to check wallet activity before retrying and does not retry automatically.
- On 2026-07-18, the built extension passed a Playwright fixture at `1280x800` and `390x844`: two card controls injected, selected amount synchronized, controls remained in viewport, and host-page `pointerdown`/`click` counters stayed at zero while the floating overlay was used.

## Trading overlay design

- The floating trading widget now uses the same surface system as the Options `Wallets` tab: `#07080b` page black, `#0c0d12` panels, `#1a1c27` borders, restrained green/red states, 8-14 px radii, and compact operational typography.
- The header exposes the chain, token symbol, and mint separately. A status strip reports wallet readiness, native balance, and fee speed before the Buy and Sell panels.
- Buy and Sell amounts remain the existing `TradeSettings` values and execute through the existing handlers. Their two-line segmented controls add only the relevant unit (`ETH` or `of position`).
- The widget is 380 px wide on desktop and `calc(100vw - 16px)` on narrow screens. Position clamping uses the same responsive width and runs on viewport resize so a saved desktop position cannot leave the widget off-screen on mobile.
- Overlay and Options use modern sans typography for navigation and labels, with tabular monospace reserved for balances, addresses, and preset values. Wallet create/import/export actions are explicitly immediate; only trade settings use the Save changes workflow.
- After the redesign, `npm test`, `npx tsc --noEmit`, `git diff --check`, `npm run build`, and `verify:dist` passed. A fresh-profile Playwright extension fixture passed at `1280x800` and `390x844`, including widget bounds, quick-button overflow, Settings overflow, GMGN amount synchronization, and host-page event isolation. No transaction was sent.

## Robinhood multi-account trading

- Robinhood/EVM accounts now use the versioned `trench.evmAccounts.v2` vault. The legacy singleton wallet migrates into the first account without exposing its private key to content scripts.
- The vault supports at most 10 unique addresses. The first account becomes active and selected; removing or changing accounts normalizes both active and batch selection.
- Active account and batch selection are separate. Options provides create, import, remove, active switch, `Select all`, and `Active only`; generated private keys stay encrypted and are copied only after an explicit extension-page export action, never rendered into the page.
- Overlay, injected GMGN BUY controls, and Trenches execute Robinhood orders through `TRENCH_EVM_BATCH_TRADE`. Each selected account receives an independent result; partial failures do not hide successful account results.
- Batch execution is sequential and each signer also has a per-account queue. This protects nonce ordering without adding automatic retry after a possible send.
- Existing native ETH routing and mandatory `simulateContract` remain inside the shared background trade handler used for every batch item. SELL percentages are resolved against each account's own token balance.
- Trading pages receive only account IDs, names, addresses, active/selected flags, and balances. EVM private keys are created/imported only in extension Options; the backup flow does not render plaintext keys into DOM or Shadow DOM controls.
- Active account keys are encrypted with a device-local AES-GCM key. Wallet creation, import, export, and trading no longer require password setup, unlock, or lock operations.
- Existing password-encrypted v2 data is copied to `trench.evmPasswordVaultArchive.v1` before conversion. An available legacy session key re-encrypts every verified account under the device key; otherwise the active account list starts empty for explicit re-import while the original encrypted records remain archived.
- On 2026-07-22, passwordless migration validation passed 23 tests, `npx tsc --noEmit`, `npm run build`, recursive distribution verification, and `git diff --check`. Browser reload was not automated because `agent-browser` is not installed; no transaction was sent.
- On 2026-07-18, `npm test` passed 12 tests, `npx tsc --noEmit` passed, `git diff --check` found no whitespace errors, and `npm run build` produced a Chrome-compatible `dist`.
- Fresh-profile Playwright checks created two EVM accounts, verified the one-time backup state, switched the active account, selected both for batch, and passed desktop `1280x800` plus mobile `390x844` overflow checks. The overlay account picker passed the same viewports and host-page event isolation. No transaction was sent.

## Website build

The React website source lives in `site/` and builds independently to `docs/` with `npm run build:site`. The extension remains in `dist/`. Use `npm run build:all` to validate and produce both outputs without one build deleting the other.

## Direct trading and Virtuals

- BUY and SELL execute directly from trusted browser clicks. The trade confirmation setting, overlay modal, GMGN card prompt, and Trenches BUY prompt were removed. The destructive wallet-removal prompt in Options remains.
- Overlay, injected GMGN cards, and Trenches reject synthetic button events through `isTrusted`. Pending-side and sequential account queue guards still prevent duplicate submissions.
- SELL approval remains exact: an allowance is reused only when it equals the current `amountIn`. A smaller or larger legacy allowance is replaced with the exact amount before the swap.
- Virtuals pair `0x87ac0ff16ff6dc1fabf8d7e8f99480698142550d` serves OPER0 token `0x6ff6cc746cfdb6b2d7f78c08ea445441827ec830` against VIRTUAL `0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31`.
- Virtuals BUY uses one payable router transaction with descriptors `WETH -> VIRTUAL` (`routeType 0`, pair `0xd95e8e2cd04c207625c6f23c974d365a5f3a91d3`, fee `3000`, tick spacing `60`) then `VIRTUAL -> token` (`routeType 4`, token address in the pool field).
- Virtuals SELL uses the confirmed reverse descriptors `token -> VIRTUAL` (`routeType 4`) then `VIRTUAL -> WETH` (`routeType 0`). Zero receiver unwraps WETH and returns native ETH; this route does not return USDG.
- Nonzero `amountOutMin` is calculated from live reserves. The quote models the WETH/VIRTUAL constant-product 0.3% fee and the router/Virtuals 1% output deductions observed in successful transfer traces, then applies user slippage. Every final router request must pass `simulateContract` before submission.
- Successful historical evidence: BUY `0x8652becfd55ed93485d5e4f0c2fbe9c0d5ae44c62e0c642e0f3b35fa480d8850`; SELL `0x6a3e12da71ea1725fa7f3c6e837f703637f60aa12582a41d5efd186015c60fac`; SELL approval spender is router `0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc`.
- On 2026-07-22, a live read-only BUY simulation for `0.00001 ETH` passed with quote `3490674217658647751870` and nonzero minimum `3316140506775715364276`. No transaction was sent.
- Final validation passed `38/38` tests, TypeScript through `npm run build`, Chrome distribution verification, `npm run build:site`, recursive dist confirmation/legacy-position scan, and `git diff --check` with only existing CRLF warnings. Browser reload was not automated because `agent-browser` is not installed; no transaction was sent.
