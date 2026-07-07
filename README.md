# Trench

Trench is an open-source Chrome extension that adds a compact trading terminal on top of Axiom. It is built for fast Solana memecoin execution: small floating UI, local settings, local signing, direct RPC/Jito submission, and an optional managed Trench RPC mode.

## What It Does

- Injects a draggable 320px trading widget into `https://axiom.trade/*`.
- Detects the current token/mint from Axiom URLs such as `/meme/<mint>?chain=sol`, with DOM detection as fallback.
- Supports Pump bonding-curve buy/sell through a lightweight manual Pump V2 instruction builder.
- Supports Jupiter buy/sell routing for migrated/routable tokens.
- Supports Auto mode: try Pump first, fall back to Jupiter when the curve is complete or missing.
- Supports normal RPC send with preflight simulation.
- Supports optional Jito low-latency send through the Block Engine transaction endpoint.
- Supports browser-wallet signing or local hot-wallet signing without approval popups.
- Supports Custom RPC with `0%` Trench fee or Trench RPC with a disclosed `0.1%` routing fee.
- Reads SOL balance and current token balance through the configured RPC.
- Stores settings locally in Chrome. Custom RPC mode does not use a Trench backend.

## Quick Start

```bash
npm install
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the local `dist/` folder.
5. Open `https://axiom.trade/`.
6. Open `Details` -> `Extension options` to configure RPC, signer, and presets.

## Trading Panel

The overlay is isolated with Shadow DOM so Axiom styles do not break it.

Default preset:

- Buy buttons: `0.0005`, `0.5`, `2`, `5` SOL.
- Sell buttons: `10%`, `30%`, `70%`, `100%`.
- Hotkeys: `1`/`2`/`3`/`4` for buys, `Q`/`W`/`E`/`R` for sells.
- Visible mode chips: signer mode, send mode, slippage, priority fee, Jito tip, protection.
- Auto fee is enabled by default with `fast` level and a `0.003 SOL` cap.

SOL balance and current token balance are fetched through the configured RPC. Realized PnL is tracked locally for trades executed through Trench by comparing pre-trade and post-trade SOL/WSOL/token balance deltas. The orders panel stores local Trench trade history with route, size, status, timestamp, error, and Solscan link when a signature is available.

Overlay settings include local reset controls for clearing browser trade history and local PnL during testing.

The header shows the detected mint and source, for example `F13T...VtiV / URL`. URL detection has priority over DOM detection so the Axiom meme page route is treated as canonical.

## Free RPC Keys

Trench has two RPC modes:

- Custom RPC: paste your own endpoint and pay `0%` Trench fee.
- Trench RPC: use the configured Trench router and pay a transparent `0.1%` routing fee.

The public Solana RPC works for quick tests:

```text
https://api.mainnet-beta.solana.com
```

For steadier free-tier endpoints, create a key and paste the full URL into the options page:

- Helius: `https://dashboard.helius.dev/`
- Shyft: `https://shyft.to/get-api-key`
- QuickNode: `https://www.quicknode.com/`
- Moralis: `https://admin.moralis.com/`

Moralis is kept as a data API candidate for metadata, balances, and history. It is not used as the trading RPC send path unless a real Solana JSON-RPC endpoint is configured.

API keys stay in Chrome local storage on your machine. In Custom RPC mode, signed transactions go directly to your selected endpoint. In Trench RPC mode, signed transactions go to the configured Trench router.

## Routing Fee

Trench RPC mode applies a `0.1%` routing fee, which is 10 basis points.

- Jupiter buy: Trench routes 99.9% of the SOL input through Jupiter and adds a same-transaction SOL transfer for the 0.1% fee.
- Jupiter sell: Trench uses Jupiter `platformFeeBps=10` with a treasury WSOL token account.
- Pump buy: Trench sends 99.9% of the SOL input to Pump and adds a same-transaction SOL transfer for the 0.1% fee.
- Pump sell: Trench sells through Pump, then transfers 0.1% of the slippage-protected minimum SOL output from the user's WSOL account to the treasury WSOL account in the same transaction.

Custom RPC mode does not add a Trench routing fee.

## Signing Modes

### Browser Wallet Approval

Uses Phantom/Solflare through an injected page-context wallet bridge. Every trade requires wallet signing approval.

Use this mode when you prefer wallet prompts and do not need one-click/no-popup execution.

### Local Hot Wallet

Imports a Solana secret key into the extension for no-popup execution.

Accepted input formats:

```json
[12, 34, 56, ...]
```

or:

```json
{ "secretKey": [12, 34, 56] }
```

The key must contain 64 bytes. Trench encrypts it locally with a password using PBKDF2 + AES-GCM. When unlocked, raw key bytes live in Chrome `storage.session` until the browser/extension session ends, the wallet is locked, or the wallet is forgotten.

Use this mode for Axiom-style fast execution without Phantom/Solflare approval popups. Use a dedicated trading hot wallet, not a vault wallet.

## Send Modes

### RPC Preflight

Default mode. Sends signed transactions to the configured Solana RPC with:

```text
skipPreflight: false
preflightCommitment: confirmed
maxRetries: 2
```

This is slower, but gives RPC simulation before broadcast.

### Jito Low Latency

Opt-in mode. Sends signed base64 transactions to:

```text
https://mainnet.block-engine.jito.wtf/api/v1/transactions
```

Jito's transaction endpoint forwards directly and uses `skip_preflight=true`. Trench keeps this as a separate mode because it trades simulation safety for speed. `bundleOnly=true` can be enabled from the options page.

### Auto Fee

Auto fee estimates a per-trade priority budget from `getRecentPrioritizationFees` on the active RPC. It samples recent priority fees, applies a level floor, then caps the total fee by `Auto max SOL`.

- `normal`: lower floor and percentile for quieter slots.
- `fast`: default Axiom-style setting for normal trading.
- `turbo`: higher percentile and floor for congestion.

In RPC mode, the auto budget becomes priority fee. In Jito mode, part of the capped budget is converted into an explicit Jito tip transfer instruction and the rest remains priority fee.

## Privacy Model

Trench is local-first by default:

- No Trench backend in Custom RPC mode.
- No Trench proxy in Custom RPC mode.
- No telemetry pipeline.
- No hosted transaction processor.
- RPC URLs and API keys stay in Chrome `storage.local`.
- Encrypted hot-wallet data stays in Chrome `storage.local`.
- Unlocked hot-wallet bytes stay in Chrome `storage.session`.
- Signed transactions go directly from your browser to your configured RPC/Jito endpoint in Custom mode.
- Signed transactions go to the configured Trench router in Trench RPC mode.

Trench must not:

- access seed phrases;
- upload private keys;
- sign automatically unless local hot-wallet mode is selected and unlocked;
- load remote JavaScript;
- hide platform fees or fee recipients.

## Execution Flow

```text
Axiom page
  -> Trench content script detects token context
  -> Background worker prepares Pump V2 or Jupiter transaction
  -> Signer path signs VersionedTransaction
       Browser wallet approval -> Phantom/Solflare
       Local hot wallet -> unlocked local key in background worker
  -> Background worker sends signed tx via RPC or Jito
  -> Overlay shows signature or error inline
```

## Security Notes

- Use a dedicated hot wallet with limited funds.
- Keep serious RPC keys out of git and paste them only into local extension settings.
- Jito low-latency mode skips preflight by design. Use RPC preflight when testing a new route.
- Public Solana RPC is rate-limited and only suitable for quick checks.
- Trench RPC mode needs a valid treasury public key configured before trades can be prepared.
- The Pump path avoids `@pump-fun/pump-sdk`, `@solana/spl-token`, and direct `bn.js` runtime dependencies to keep the extension bundle smaller and easier to audit.

## Current Limits

- PnL starts from trades executed after the local ledger exists. Existing positions need historical fills before full cost basis can be reconstructed.
- The orders panel is local browser history, not an exchange-side order book or indexer.
- PumpSwap-specific post-migration routing is not implemented yet.
- The Trench RPC router service is configuration-ready, but the hosted router itself must be deployed separately.

## Development

```bash
npm install
npm run build
```

Build output goes to `dist/`, which can be loaded as an unpacked Chrome extension.

Run a local RPC router process for deployment testing:

```bash
TRENCH_RPC_UPSTREAMS="https://api.mainnet-beta.solana.com,https://your-helius-url" npm run router
```

The router exposes:

- `POST /rpc`: JSON-RPC proxy with upstream retry and scoring.
- `GET /health`: redacted upstream status.

Deploy the router behind HTTPS before using it as `Trench RPC router` in the extension. Chrome extension validation requires an HTTPS RPC URL.

## Roadmap

- PumpSwap route detection and execution.
- Hosted Trench RPC router with health scoring, rate limiting, and provider rotation.
- Jito tip-floor tuning from live block engine data.
- Better transaction history and order tracking.
- Optional Moralis/Shyft/Helius data adapters for metadata, balances, and history.
