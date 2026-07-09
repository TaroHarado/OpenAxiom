# Trench

**Built by traders, for traders.** Trench is a free, open-source Chrome/Chromium extension that puts a fast trading terminal directly on top of the charts you already use — **gmgn** and **Axiom** — across **Solana** and **Robinhood Chain**.

Stop paying hosted terminals a cut of every trade to fund their marketing. Trench takes **0% platform fee**, holds no funds, and runs on **your own RPC** (free public or paid — your choice). Your keys stay encrypted on your device.

- **0% fees, always.** No default fee, no optional fee, no treasury cut.
- **Bring your own RPC.** Speed comes from your endpoint, not a paywall.
- **Zero custody.** Keys are device-encrypted; nothing is sent to any server.
- **Open source, MIT.** Fork it, audit it, own it.

## What It Does

- **Floating overlay** — a draggable buy/sell terminal injected over any token page on `gmgn.ai` and `axiom.trade`. Presets, hotkeys, slippage, live position and PnL, always one keystroke away.
- **Quick-buy on cards** — a BUY button injected onto every token card in the gmgn feed. Snipe from the list without opening the token page (address is read at click time, so it survives DOM recycling).
- **Two chains**
  - **Solana** — buy/sell through Jupiter and a lightweight Pump.fun instruction builder, with an Auto mode that tries Pump first and falls back to Jupiter.
  - **Robinhood Chain** — buy/sell through Uniswap V3 (USDG or ETH input) with automatic pool selection and a slippage guard.
- **Wallet manager** — a two-column Wallets page in Options: Solana hot wallet on the left, Robinhood Chain (ERC-20) wallet on the right, each with live balances (SOL / ETH + USDG) and import / lock / forget controls.
- **Automatic local PnL** — realized PnL is tracked per token from real pre-trade vs post-trade balance deltas. On Solana it is denominated in SOL (so priority fee / Jito tip / gas are already included); on Robinhood Chain it is denominated in USDG.
- **Send modes** — standard RPC with preflight simulation, or opt-in Jito low-latency send. Auto priority fee estimates a per-trade budget from recent network fees.
- **Signing** — use your browser wallet (Phantom/Solflare approval) or an imported hot key for no-popup execution.

## Quick Start

Requires Node.js 18+.

```bash
git clone https://github.com/TaroHarado/Trench.git
cd Trench
npm install
npm run build
```

Load it into Chromium (Chrome / Brave / Edge):

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the generated `dist/` folder.
5. Pin the Trench icon for quick popup access.

## Your First Trade in 5 Steps

1. **Import a wallet.** Open the extension popup (or **Options → Wallets**). Import a **Solana** hot key (base58 / hex / bytes / JSON array) and/or a **Robinhood Chain** ERC-20 key (`0x` + 64 hex). Keys are encrypted on your device. Use a dedicated burner wallet, not your vault.
2. **Fund it.**
   - *Solana:* send SOL to the imported address. SOL covers both trades and network fees.
   - *Robinhood Chain:* send **USDG** to trade with, plus a little **ETH** for gas. Balances show up on the Wallets page.
3. **Open a market.** Go to `gmgn.ai` or `axiom.trade` and open any token, or use the BUY button on a card in the gmgn feed. The floating terminal mounts automatically.
4. **Set your size and buy.** Pick a buy amount (or press `1`–`4`), confirm if confirmations are on. The order is signed locally and sent through your RPC.
5. **Watch PnL and sell.** The Sell section shows your position and realized PnL (SOL on Solana, USDG on Robinhood Chain), updating automatically after each fill — fees included. Sell with a percent button (or `Q`/`W`/`E`/`R`).

## RPC — Bring Your Own

Trench ships pre-configured with free public endpoints (**PublicNode** and **dRPC**) — no API key required. Public RPC is fine for getting started but is rate-limited under load. For steadier throughput, paste your own endpoint in **Options → Advanced**:

- Helius: `https://dashboard.helius.dev/`
- Shyft: `https://shyft.to/get-api-key`
- QuickNode: `https://www.quicknode.com/`

Either way, the platform fee is the same: **nothing**. API keys and RPC URLs stay in Chrome local storage on your machine, and signed transactions go directly from your browser to your chosen endpoint.

## Signing Modes

### Browser wallet approval
Uses Phantom/Solflare through an injected page-context bridge. Every trade requires wallet approval. Use this when you prefer explicit prompts.

### Local hot wallet
Imports a key into the extension for no-popup execution.

- **Solana** accepts base58 private-key strings, `0x`/raw hex, comma/space-separated bytes, JSON byte arrays, and exported `secretKey` objects. A 32-byte seed is expanded into a keypair; a 64-byte keypair is used directly.
- **Robinhood Chain** accepts a standard `0x` + 64-hex EVM private key.

Keys are encrypted locally (PBKDF2 + AES-GCM). When unlocked, raw key material lives in Chrome `storage.session` until the session ends, the wallet is locked, or it is forgotten. Use a dedicated trading hot wallet, not a vault wallet.

## Send Modes

- **RPC preflight** (default) — sends to your Solana RPC with `skipPreflight: false`, `preflightCommitment: confirmed`. Slower, but simulates before broadcast.
- **Jito low latency** (opt-in) — sends base64 transactions to the Jito Block Engine transaction endpoint (`skip_preflight=true`). Trades simulation safety for speed. `bundleOnly` can be enabled in Options.
- **Auto fee** — estimates a per-trade priority budget from recent prioritization fees, applies a level floor (`normal` / `fast` / `turbo`), and caps it by `Auto max SOL`. In Jito mode, part of the budget becomes an explicit tip.

## PnL Model

PnL is measured from real balance deltas around each trade Trench executes, so trading costs are baked in:

- **Solana** — everything is denominated in SOL, so priority fee, Jito tip, and network fees are already reflected in the number. Buys build cost basis; sells realize PnL.
- **Robinhood Chain** — denominated in USDG. Buys add USDG cost basis; sells realize `USDG received − proportional cost basis`, which includes the swap price and pool fee. Gas is paid separately in ETH.

PnL starts from the first trade after the local ledger exists. The **History** tab can rescan recent Solana swaps to reconstruct cost basis for a token already in the wallet. The orders panel is a local browser log, not an exchange order book.

## Privacy Model

Trench is local-first:

- No backend, no proxy, no telemetry, no hosted transaction processor.
- RPC URLs, API keys, encrypted keys, settings, and PnL all stay in Chrome storage on your device.
- Signed transactions go directly from your browser to your configured RPC / Jito endpoint.

Trench never accesses seed phrases, uploads private keys, signs automatically outside unlocked hot-wallet mode, loads remote JavaScript, or hides fees (there are none).

## Execution Flow

```text
gmgn / Axiom page
  -> content script detects the token + chain
  -> background worker builds the swap (Jupiter/Pump on Solana, Uniswap V3 on Robinhood Chain)
  -> signer path signs the transaction
       browser wallet approval -> Phantom/Solflare
       local hot wallet        -> unlocked key in the background worker
  -> background worker sends via RPC or Jito
  -> overlay shows the signature/hash and updates PnL
```

## Security Notes

- Use a dedicated hot wallet with limited funds.
- Keep serious RPC keys out of git; paste them only into local extension settings.
- Jito mode skips preflight by design — use RPC preflight when testing a new route.
- Public RPC is rate-limited; use your own endpoint for heavy sessions.

## Development

```bash
npm install
npm run build   # tsc --noEmit + vite build (popup/options) + content build
```

Build output goes to `dist/`, loadable as an unpacked extension. The landing page lives in `docs/` and can be served statically (e.g. `npx serve docs`).

## Disclaimer

Trench is experimental open-source software provided "as is", without warranty of any kind. It is not affiliated with Robinhood, gmgn.ai, Axiom, Solana, Jupiter, or Uniswap. Trading new tokens carries substantial risk of loss. Verify what you sign. Never trade with funds you cannot afford to lose.

## License

MIT — see [LICENSE](./LICENSE).
