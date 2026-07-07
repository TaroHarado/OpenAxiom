import type { SendSignedTransactionRequest, TradeRequest, TradeResponse } from './types';
import { preparePumpTrade } from './pumpEngine';

declare const chrome: {
  runtime: {
    onMessage: {
      addListener: (
        callback: (message: unknown, sender: unknown, sendResponse: (response: TradeResponse) => void) => boolean | void
      ) => void;
    };
  };
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
const LAMPORTS_PER_SOL = 1_000_000_000;
const PUBLIC_KEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BUY_SOL = 100;
const MAX_PRIORITY_FEE_SOL = 0.1;
const MAX_SLIPPAGE_PERCENT = 50;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as Partial<TradeRequest | SendSignedTransactionRequest>;

  if (request.type === 'TRADEWIZ_PREPARE_TRADE') {
    prepareTrade(request as TradeRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (request.type === 'TRADEWIZ_SEND_SIGNED_TRANSACTION') {
    sendSignedTransaction(request as SendSignedTransactionRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  return false;
});

async function prepareTrade(request: TradeRequest): Promise<TradeResponse> {
  validateTradeRequest(request);
  const mint = request.mint as string;

  if (request.settings.executionMode === 'pump') {
    return preparePumpTrade(request);
  }

  if (request.settings.executionMode === 'auto') {
    try {
      return await preparePumpTrade(request);
    } catch (error) {
      if (!isPumpFallbackError(error)) throw error;
    }
  }

  if (request.side === 'sell') {
    throw new Error('Jupiter sell needs indexed token balance; switch Engine to Pump for bonding-curve sells');
  }

  const amountLamports = Math.round(request.amount * LAMPORTS_PER_SOL);
  const quote = await fetchJupiterQuote({
    inputMint: SOL_MINT,
    outputMint: mint,
    amount: amountLamports,
    slippageBps: Math.round(request.settings.slippage * 100)
  });

  const swap = await fetchJson<{ swapTransaction: string; lastValidBlockHeight?: number }>(JUPITER_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: request.wallet,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: request.settings.priorityFee > 0 ? Math.round(request.settings.priorityFee * LAMPORTS_PER_SOL) : undefined
    })
  });

  return {
    ok: true,
    route: 'jupiter',
    swapTransaction: swap.swapTransaction,
    lastValidBlockHeight: swap.lastValidBlockHeight,
    quoteSummary: `${request.amount} SOL via Jupiter`
  };
}

function isPumpFallbackError(error: unknown) {
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes('bonding curve account not found') ||
    message.includes('bonding curve is complete') ||
    message.includes('use jupiter') ||
    message.includes('use pumpswap')
  );
}

async function sendSignedTransaction(request: SendSignedTransactionRequest): Promise<TradeResponse> {
  if (!request.signedTransaction) throw new Error('Missing signed transaction');
  validateRpcUrl(request.rpcUrl);

  const result = await fetchJson<{ result?: string; error?: { message?: string } }>(request.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tradewiz-send',
      method: 'sendTransaction',
      params: [
        request.signedTransaction,
        {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 2
        }
      ]
    })
  });

  if (result.error) throw new Error(result.error.message ?? 'RPC send failed');
  if (!result.result) throw new Error('RPC returned no signature');

  return { ok: true, signature: result.result };
}

function validateTradeRequest(request: TradeRequest) {
  if (!isPublicKeyString(request.mint)) throw new Error('Token mint not found');
  if (!isPublicKeyString(request.wallet)) throw new Error('Wallet not connected');
  if (!Number.isFinite(request.amount) || request.amount <= 0) throw new Error('Invalid order size');
  if (request.side === 'buy' && request.amount > MAX_BUY_SOL) throw new Error(`Buy size exceeds ${MAX_BUY_SOL} SOL cap`);
  if (request.side === 'sell' && request.amount > 100) throw new Error('Sell percent cannot exceed 100%');

  const { settings } = request;
  if (!Number.isFinite(settings.slippage) || settings.slippage < 0 || settings.slippage > MAX_SLIPPAGE_PERCENT) {
    throw new Error(`Slippage must be between 0% and ${MAX_SLIPPAGE_PERCENT}%`);
  }
  if (!Number.isFinite(settings.priorityFee) || settings.priorityFee < 0 || settings.priorityFee > MAX_PRIORITY_FEE_SOL) {
    throw new Error(`Priority fee must be between 0 and ${MAX_PRIORITY_FEE_SOL} SOL`);
  }
  if (!Number.isFinite(settings.jitoTip) || settings.jitoTip < 0 || settings.jitoTip > MAX_PRIORITY_FEE_SOL) {
    throw new Error(`Jito tip must be between 0 and ${MAX_PRIORITY_FEE_SOL} SOL`);
  }
  validateRpcUrl(settings.rpcUrl);
}

function validateRpcUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid RPC URL');
  }

  if (url.protocol !== 'https:') throw new Error('RPC URL must use HTTPS');
  if (!isAllowedRpcHost(url.hostname)) throw new Error('RPC host is not allowed by extension permissions');
}

function isAllowedRpcHost(hostname: string) {
  return hostname === 'api.mainnet-beta.solana.com' || hostname.endsWith('.helius-rpc.com') || hostname.endsWith('.quiknode.pro');
}

function isPublicKeyString(value: string | null | undefined) {
  return typeof value === 'string' && PUBLIC_KEY_PATTERN.test(value);
}

async function fetchJupiterQuote(params: { inputMint: string; outputMint: string; amount: number; slippageBps: number }) {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set('inputMint', params.inputMint);
  url.searchParams.set('outputMint', params.outputMint);
  url.searchParams.set('amount', String(params.amount));
  url.searchParams.set('slippageBps', String(params.slippageBps));
  url.searchParams.set('onlyDirectRoutes', 'false');
  url.searchParams.set('asLegacyTransaction', 'false');

  return fetchJson<unknown>(url.toString());
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as T & { error?: string; message?: string };

  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.message ?? `HTTP ${response.status}`);
  }

  return payload as T;
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Tx failed';
}
