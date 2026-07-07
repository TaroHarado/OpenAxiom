# Trench

Trench is an open-source Chrome extension that adds a compact trading terminal on top of Axiom. It is built for fast Solana memecoin execution: small floating UI, local settings, local signing, direct RPC/Jito submission, and no hosted Trench backend.

## What It Does

- Injects a draggable 320px trading widget into `https://axiom.trade/*`.
- Detects the current token/mint from the Axiom page when possible.
- Supports Pump bonding-curve buy/sell through a lightweight manual Pump V2 instruction builder.
- Supports Jupiter buy routing for migrated/routable tokens.
- Supports Auto mode: try Pump first, fall back to Jupiter when the curve is complete or missing.
- Supports normal RPC send with preflight simulation.
- Supports optional Jito low-latency send through the Block Engine transaction endpoint.
- Supports browser-wallet signing or local hot-wallet signing without approval popups.
- Stores settings locally in Chrome. Trench does not run a server.

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

The current balance, position, and order list are still placeholder UI. Real indexing is on the roadmap.

## Free RPC Keys

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

API keys stay in Chrome local storage on your machine. They are not sent to a Trench backend.

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

## Privacy Model

Trench is local-first:

- No Trench backend.
- No Trench proxy.
- No telemetry pipeline.
- No hosted transaction processor.
- RPC URLs and API keys stay in Chrome `storage.local`.
- Encrypted hot-wallet data stays in Chrome `storage.local`.
- Unlocked hot-wallet bytes stay in Chrome `storage.session`.
- Signed transactions go directly from your browser to your configured RPC or Jito endpoint.

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
- The Pump path avoids `@pump-fun/pump-sdk`, `@solana/spl-token`, and direct `bn.js` runtime dependencies to keep the extension bundle smaller and easier to audit.

## Current Limits

- Position, wallet balance, and order list are UI placeholders.
- Jupiter sell needs real token balance indexing.
- PumpSwap-specific post-migration routing is not implemented yet.
- Jito tips are configured in UI but full integrated tip-instruction strategy still needs refinement.

## Development

```bash
npm install
npm run build
```

Build output goes to `dist/`, which can be loaded as an unpacked Chrome extension.

## Roadmap

- Real wallet balance and token position indexing.
- Jupiter sell path for migrated tokens.
- PumpSwap route detection and execution.
- Jito tip-floor helper and safer tip-instruction integration.
- Better transaction history and order tracking.
- Optional Moralis/Shyft/Helius data adapters for metadata, balances, and history.
