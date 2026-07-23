# Trench

Trench is a free, open-source Chrome/Chromium trading terminal for Robinhood Chain markets on GMGN. It charges no platform fee, holds no funds, and signs transactions inside the extension.

- **Floating terminal:** buy and sell from Robinhood token pages on `gmgn.ai`.
- **Card quick-buy:** injects an amount selector and BUY action into supported GMGN cards. The token address is read again at click time so recycled card DOM cannot submit a stale address.
- **Robinhood routes:** supports native ETH buys through Uniswap V3 direct and multihop pools, Virtuals bonding routes, Doppler V4 pools, and verified portal routes.
- **Multi-account execution:** stores up to ten accounts, separates the active account from batch selection, and reports every account result independently.
- **Local custody:** encrypts private keys with a device-local AES-GCM key. Trading pages receive account IDs, names, addresses, balances, and status only.
- **Local activity state:** stores order history and per-token balance state in browser storage.

## Quick Start

Requires Node.js 18 or newer.

```bash
git clone https://github.com/TaroHarado/Trench.git
cd Trench
npm install
npm run build
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.
5. Open Trench Options and create or import a Robinhood Chain account.
6. Fund the account with ETH for buys and gas, then open `https://gmgn.ai/?chain=robinhood`.

Use a dedicated trading wallet with limited funds. Imported keys must be standard EVM private keys with `0x` followed by 64 hexadecimal characters.

## Execution Guarantees

- Every buy is forced to native ETH in the background worker, even if a caller supplies another input currency.
- Route discovery verifies pools, factories, initializers, or registries instead of inferring a platform from token naming.
- Every swap is simulated before submission.
- Each account has a serialized trade queue to protect nonce ordering.
- Batch trades execute sequentially and preserve successful account results when another account fails.
- A submission journal records transaction hashes and states locally.
- An invalidated extension context never causes an automatic trade retry. The UI directs the trader to check wallet activity first.
- The content script accepts privileged responses only through Chrome extension messaging; private keys are never exposed to page or Shadow DOM code.

## Routing

Robinhood buys first try a direct or multihop Uniswap V3 route. If no suitable V3 route exists, route discovery checks supported launch mechanisms, including Virtuals and Doppler V4. Native ETH is passed as `msg.value`; Trench does not add separate wrap or approval transactions before a native buy.

Sells resolve the percentage against each selected account's token balance. Slippage is configured in Options and enforced by the background route builder.

## Privacy Model

- No telemetry backend, hosted transaction processor, or hidden treasury transfer.
- Encrypted wallet records, the device-local encryption key, and settings stay in Chrome local storage.
- There is no password, unlock, or lock workflow. Device access and the Chrome profile boundary protect the local key.
- A previous password-encrypted vault is preserved locally before migration. If its old session key is unavailable, re-import the wallets that are no longer listed.
- Signed transactions go directly to the Robinhood Chain RPC endpoint declared in the extension manifest.
- The extension loads no remote JavaScript.

## Development

```bash
npm install
npm test
npm run build
npm run build:site
```

`npm run build` type-checks and builds the unpacked extension into `dist/`, then validates the distribution. `npm run build:site` builds the website from `site/` into `docs/`. `npm run build:all` produces both outputs.

Read-only route checks are available through `npm run benchmark:rh-routes` and `node scripts/simulate-robinhood-buys.mjs`. They do not send transactions.

## Security Notes

- Verify token addresses, route details, and transaction hashes.
- Protect the Chrome profile and operating-system account that hold the device-local encryption key.
- Never import a primary vault or long-term custody key.
- Treat local trade history as an operational log, not an exchange order book or accounting record.

## Disclaimer

Trench is experimental open-source software provided "as is", without warranty of any kind. It is not affiliated with Robinhood, GMGN, Uniswap, Virtuals, or Doppler. Trading new tokens carries substantial risk of loss. Verify what you sign and never trade with funds you cannot afford to lose.

## License

MIT, see [LICENSE](./LICENSE).
