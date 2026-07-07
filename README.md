# TradeWiz Axiom Overlay

Open-source Chrome Manifest V3 extension MVP for a floating TradeWiz trading terminal on top of Axiom.

The extension injects a Shadow DOM widget into `https://axiom.trade/*`, keeps Axiom layout untouched, saves widget position/settings locally, and routes trade button clicks through a background service worker message layer.

Current execution status:

- Jupiter buy path is wired: SOL -> current mint, wallet signing, RPC send.
- Direct Pump bonding-curve buy/sell is wired through a lightweight manual V2 instruction builder with Pump fee-tier decoding. No Pump SDK runtime dependency.
- Pump sell uses the user's ATA balance and sells the selected percentage.
- Auto mode tries Pump bonding curve first, then falls back to Jupiter when the curve is complete or missing.

## Features

- Floating 320px dark trading widget with high z-index.
- Draggable header with persisted position in `localStorage`.
- Collapse to compact button.
- Shadow DOM style isolation.
- Buy quick buttons: `0.0005`, `0.5`, `2`, `5`.
- Sell quick buttons: `10%`, `30%`, `70%`, `100%`.
- Slippage, priority fee, Jito tip and protection chips.
- Compact settings panel for presets and hotkeys.
- Chrome extension settings page at `chrome://extensions` -> TradeWiz -> Details -> Extension options.
- Active orders list with cancel state.
- Inline loading, success and error states. No browser alerts.
- Axiom token/mint extraction from URL/DOM best-effort heuristics.
- Hotkeys only when overlay is active and not while typing.
- Phantom/Solflare signing bridge through an injected page-context script.
- Jupiter quote/swap transaction preparation in the background service worker.
- Signed transaction submission through the configured RPC URL.
- Pump `buy_exact_quote_in_v2` / `sell_v2` transaction preparation in the background service worker.

## What It Looks Like

After installation, open `https://axiom.trade/*`. A compact dark TradeWiz terminal floats over the page, roughly 320px wide. It has a draggable header, wallet button, preset controls, buy/sell quick buttons, slippage/fee chips, settings drawer, order list, and inline transaction status.

Chrome also exposes a full settings page for the extension. Use it to configure engine mode, public RPC URL, buy amounts, sell percentages, slippage, priority fee, Jito tip, protection, confirmation, and hotkeys.

## Install In Chrome

```bash
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the local `dist/` folder.
5. Open `https://axiom.trade/` and the floating widget will appear on supported pages.
6. Open extension settings through `Details` -> `Extension options`.

Default test RPC is `https://api.mainnet-beta.solana.com`. It is public and rate-limited, so it is fine for testing but should be replaced with a dedicated Helius/QuickNode endpoint for serious use.

## Security Model

This extension never asks for, stores, uploads, or derives private keys.

Signing should be handled only by the user's installed wallet extension, such as Phantom or Solflare, when the execution layer is connected.

The extension can:

- read token information from supported Axiom pages;
- build or request Solana transactions;
- request wallet signature through a browser wallet provider;
- submit signed transactions to a configured RPC endpoint.

The extension must not:

- access seed phrases;
- import private keys;
- sign without wallet confirmation;
- load remote JavaScript;
- hide platform fees or fee recipients.

The Pump path intentionally avoids `@pump-fun/pump-sdk`, `@solana/spl-token`, and `bn.js` to keep the dependency surface smaller. It derives Pump PDAs locally, decodes the Global, BondingCurve, and FeeConfig accounts directly, creates the user's token account idempotently on buys, and leaves final transaction simulation/approval to the wallet/RPC path.

## Development

```bash
npm install
npm run build
```

Then load `dist/` as an unpacked extension in Chromium.

## Execution Layer TODO

- Replace mocked balances/positions/orders with indexed wallet state.
- Add Jupiter sell execution after token balance indexing for migrated tokens.
- Add PumpSwap-specific route detection after migration.
- Add Jito bundle/tip execution mode and retry policy.

## Runtime Flow

```text
Content script UI
  -> injected page wallet bridge connects Phantom/Solflare
  -> background service worker prepares Pump V2 tx or Jupiter swap tx
  -> injected page wallet bridge signs VersionedTransaction
  -> background service worker sends signed tx to configured RPC
  -> UI shows signature/error inline
```

No private key is available to the content script, background worker, or injected script.
