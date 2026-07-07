import type { TokenContext } from './types';

const MINT_PATTERN = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
const AXIOM_MEME_PATH_PATTERN = /^\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\/|$)/;

export function readAxiomTokenContext(): TokenContext {
  const urlMint = readMintFromUrl();
  const domMint = readMintFromDom();
  const mint = urlMint ?? domMint;
  const symbol = readSymbolFromDom() ?? 'YOLO';

  return { mint, symbol, source: urlMint ? 'axiom-url' : domMint ? 'dom' : 'unknown' };
}

export function parseAxiomMintFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const memePathMint = url.pathname.match(AXIOM_MEME_PATH_PATTERN)?.[1];
    if (memePathMint) return memePathMint;
    return url.href.match(MINT_PATTERN)?.[0] ?? null;
  } catch {
    return rawUrl.match(MINT_PATTERN)?.[0] ?? null;
  }
}

function readMintFromDom(): string | null {
  const attributes = ['data-mint', 'data-token-mint', 'data-address', 'data-ca'];

  for (const attribute of attributes) {
    const node = document.querySelector(`[${attribute}]`);
    const value = node?.getAttribute(attribute);
    if (value && MINT_PATTERN.test(value)) return value.match(MINT_PATTERN)?.[0] ?? null;
  }

  const textCandidates = Array.from(document.querySelectorAll('a[href], button, [title]'))
    .slice(0, 200)
    .map((node) => `${node.getAttribute('href') ?? ''} ${node.getAttribute('title') ?? ''} ${node.textContent ?? ''}`);

  for (const text of textCandidates) {
    const match = text.match(MINT_PATTERN);
    if (match) return match[0];
  }

  return null;
}

function readMintFromUrl(): string | null {
  return parseAxiomMintFromUrl(window.location.href);
}

function readSymbolFromDom(): string | null {
  const selectors = ['[data-symbol]', '[data-token-symbol]', 'h1', 'h2'];

  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const value = node?.getAttribute('data-symbol') ?? node?.getAttribute('data-token-symbol') ?? node?.textContent;
    const symbol = value?.match(/\$?([A-Z0-9]{2,12})/)?.[1];
    if (symbol) return symbol;
  }

  return null;
}
