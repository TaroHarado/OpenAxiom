import type { TokenContext } from './types';

const EVM_ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;
const EVM_ADDRESS_GLOBAL = /0x[0-9a-fA-F]{40}/g;
// gmgn token URLs are /robinhood/token/<addr> or /robinhood/token/<refcode>_<addr>
const GMGN_RH_PATH = /\/robinhood\/token\/(?:[^/]*?_)?(0x[0-9a-fA-F]{40})/i;

// Robinhood Chain infrastructure addresses that are NOT the traded token.
// If detection ever picks one of these up, we skip it so the overlay never
// sends a quote/wallet-token address into the swap router by mistake.
const INFRA_ADDRESSES = new Set(
  [
    '0x0000000000000000000000000000000000000000', // zero
    '0x5fc5360d0400a0fd4f2af552add042d716f1d168', // USDG
    '0x0bd7d308f8e1639fab988df18a8011f41eacad73', // WETH
    '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', // Uniswap V3 factory
    '0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77', // Universal Router
  ].map((a) => a.toLowerCase()),
);

function isInfraAddress(addr: string): boolean {
  return INFRA_ADDRESSES.has(addr.toLowerCase());
}
// gmgn is an SPA and drops the ?chain=robinhood query when you open a token,
// so we default gmgn.ai to Robinhood Chain unless the URL clearly points at another chain.
const GMGN_OTHER_CHAIN_PATH = /^\/(sol(?:ana)?|eth|ethereum|base|bsc|bnb|tron|blast|sui|ton|arb|arbitrum|op|optimism|polygon|matic|avax|zksync|scroll|linea|mantle)\b/i;
const GMGN_OTHER_CHAIN_QUERY = /chain=(sol(?:ana)?|eth|ethereum|base|bsc|bnb|tron|blast|sui|ton|arb|op|polygon|avax)/i;

export function isGmgnRobinhood(): boolean {
  if (window.location.hostname !== 'gmgn.ai') return false;
  const { pathname, search } = window.location;
  if (pathname.includes('/robinhood') || /chain=robinhood/i.test(search)) return true;
  // Default to Robinhood on gmgn unless another chain is explicitly in the URL.
  return !GMGN_OTHER_CHAIN_PATH.test(pathname) && !GMGN_OTHER_CHAIN_QUERY.test(search);
}

export function readGmgnTokenContext(): TokenContext {
  const urlMint = readEvmAddressFromUrl();
  const domMint = urlMint ?? readEvmAddressFromDom();
  const symbol = readSymbolFromGmgn() ?? 'TOKEN';
  return {
    mint: domMint,
    symbol,
    source: urlMint ? 'url' : domMint ? 'dom' : 'unknown',
  };
}

function readEvmAddressFromUrl(): string | null {
  // The token page path is the single most reliable source — trust it first,
  // even if the address happens to look like infra (it won't on a token page).
  const fromPath = window.location.pathname.match(GMGN_RH_PATH)?.[1];
  if (fromPath) return fromPath;

  const params = new URLSearchParams(window.location.search);
  const addr = params.get('address') ?? params.get('token') ?? params.get('ca');
  if (addr && EVM_ADDRESS_PATTERN.test(addr) && !isInfraAddress(addr)) return addr;

  // Fallback: scan the whole href but never return an infra address.
  for (const m of window.location.href.matchAll(EVM_ADDRESS_GLOBAL)) {
    if (!isInfraAddress(m[0])) return m[0];
  }
  return null;
}

function readEvmAddressFromDom(): string | null {
  const attrs = ['data-address', 'data-token', 'data-ca', 'data-mint'];
  for (const attr of attrs) {
    const val = document.querySelector(`[${attr}]`)?.getAttribute(attr);
    if (val && EVM_ADDRESS_PATTERN.test(val) && !isInfraAddress(val)) return val;
  }
  const candidates = Array.from(document.querySelectorAll('a[href], [title], [data-value]'))
    .slice(0, 300)
    .map(n => `${n.getAttribute('href') ?? ''} ${n.getAttribute('title') ?? ''} ${n.getAttribute('data-value') ?? ''} ${n.textContent ?? ''}`);
  for (const text of candidates) {
    for (const m of text.matchAll(EVM_ADDRESS_GLOBAL)) {
      if (!isInfraAddress(m[0])) return m[0];
    }
  }
  return null;
}

function readSymbolFromGmgn(): string | null {
  const specific = [
    '[data-symbol]',
    '.token-name',
    '.token-symbol',
    'h1.symbol',
    '.symbol',
  ];
  for (const sel of specific) {
    const el = document.querySelector(sel);
    const val = el?.getAttribute('data-symbol') ?? el?.textContent?.trim();
    const sym = val?.match(/^([A-Z0-9]{2,10})$/)?.[1];
    if (sym) return sym;
  }
  // fallback: find standalone ticker in page title
  const title = document.title;
  const m = title.match(/\b([A-Z]{2,8})\b/);
  if (m) return m[1];
  return null;
}
