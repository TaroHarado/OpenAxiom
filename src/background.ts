import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { HotWalletRequest, HotWalletResponse, IndexHistoryRequest, IndexHistoryResponse, PositionRequest, PositionResponse, SendSignedTransactionRequest, SignAndSendLocalRequest, TradeRequest, TradeResponse, TradeSettings } from './types';
import { preparePumpTrade } from './pumpEngine';
import { getActiveRpcUrl, SETTINGS_KEY, usesTrenchRouting } from './storage';
import { createJitoTipInstruction } from './jito';

declare const chrome: {
  runtime: {
    onMessage: {
      addListener: (
        callback: (message: unknown, sender: unknown, sendResponse: (response: TradeResponse | HotWalletResponse | PositionResponse | IndexHistoryResponse) => void) => boolean | void
      ) => void;
    };
  };
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
  };
};

type ChromeStorageArea = {
  get: (key: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (key: string | string[]) => Promise<void>;
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
const JUPITER_SWAP_INSTRUCTIONS_URL = 'https://quote-api.jup.ag/v6/swap-instructions';
const LAMPORTS_PER_SOL = 1_000_000_000;
const PUBLIC_KEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BUY_SOL = 100;
const MAX_PRIORITY_FEE_SOL = 0.1;
const MAX_SLIPPAGE_PERCENT = 50;
const TRENCH_FEE_BPS = 10;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CREATE_ATA_IDEMPOTENT_DISCRIMINATOR = 1;
const HOT_WALLET_STORAGE_KEY = 'trench.hotWallet.v1';
const HOT_WALLET_SESSION_KEY = 'trench.hotWallet.session.v1';
const AUTO_FEE_COMPUTE_UNIT_ESTIMATE = 400_000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as Partial<TradeRequest | SendSignedTransactionRequest | SignAndSendLocalRequest | HotWalletRequest | PositionRequest | IndexHistoryRequest>;

  if (request.type === 'TRENCH_PREPARE_TRADE') {
    prepareTrade(request as TradeRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (request.type === 'TRENCH_SEND_SIGNED_TRANSACTION') {
    sendSignedTransaction(request as SendSignedTransactionRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (request.type === 'TRENCH_SIGN_AND_SEND_LOCAL') {
    signAndSendLocal(request as SignAndSendLocalRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (request.type === 'TRENCH_GET_POSITION') {
    getPosition(request as PositionRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (isHotWalletRequest(request)) {
    handleHotWalletRequest(request as HotWalletRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (request.type === 'TRENCH_INDEX_HISTORY') {
    indexWalletHistory(request as IndexHistoryRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, scanned: 0, matched: 0, costBasisSol: 0, realizedPnlSol: 0, error: normalizeError(error) }));
    return true;
  }

  if ((request as { type?: string }).type === 'TRENCH_SYNC_TRADE_HISTORY') {
    const entries = (request as { entries?: unknown }).entries;
    if (Array.isArray(entries)) {
      void chrome.storage.local.set({ [TRADE_HISTORY_KEY]: entries.slice(0, 500) });
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function prepareTrade(request: TradeRequest): Promise<TradeResponse> {
  validateTradeRequest(request);
  const requestWithFees = await applyAutoFee(request);
  request = requestWithFees;
  const mint = request.mint as string;
  const feeRecipient = getTrenchFeeRecipient(request.settings);

  if (request.settings.executionMode === 'pump') {
    return preparePumpTrade(request);
  }

  if (request.settings.executionMode === 'auto') {
    const isPumpSwap = await isPumpSwapToken(mint, getActiveRpcUrl(request.settings));
    if (!isPumpSwap) {
      try {
        return await preparePumpTrade(request);
      } catch (error) {
        if (!isPumpFallbackError(error)) throw error;
      }
    }
  }

  const trenchFeeLamports = feeRecipient && request.side === 'buy' ? calculateTrenchFee(BigInt(Math.round(request.amount * LAMPORTS_PER_SOL))).toString() : '0';
  const spendLamports = BigInt(Math.round(request.amount * LAMPORTS_PER_SOL)) - BigInt(trenchFeeLamports);
  if (request.side === 'buy' && spendLamports <= 0n) throw new Error('Trade amount too small after fee');
  const amount = request.side === 'buy' ? spendLamports.toString() : await getJupiterSellAmount(request);
  const quote = await fetchJupiterQuote({
    inputMint: request.side === 'buy' ? SOL_MINT : mint,
    outputMint: request.side === 'buy' ? mint : SOL_MINT,
    amount,
    slippageBps: Math.round(request.settings.slippage * 100),
    platformFeeBps: feeRecipient && request.side === 'sell' ? TRENCH_FEE_BPS : 0
  });

  if (feeRecipient || shouldAddJitoTip(request.settings)) {
    const swap = await buildJupiterSwapInstructions(request, quote, feeRecipient, BigInt(trenchFeeLamports));
    return {
      ok: true,
      route: 'jupiter',
      swapTransaction: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
      quoteSummary: request.side === 'buy' ? `${request.amount} SOL via Jupiter${feeRecipient ? ' incl. 0.1% Trench fee' : ''}` : `${request.amount}% via Jupiter${feeRecipient ? ' incl. 0.1% Trench fee' : ''}`
    };
  }

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
    quoteSummary: request.side === 'buy' ? `${request.amount} SOL via Jupiter` : `${request.amount}% via Jupiter`
  };
}

async function applyAutoFee(request: TradeRequest): Promise<TradeRequest> {
  if (!request.settings.autoFee) return request;

  const fee = await estimateAutoFee(request.settings).catch(() => null);
  if (!fee) return request;

  return {
    ...request,
    settings: {
      ...request.settings,
      priorityFee: fee.priorityFeeSol,
      jitoTip: request.settings.sendMode === 'jito' ? fee.jitoTipSol : 0
    }
  };
}

async function estimateAutoFee(settings: TradeSettings) {
  const rpcUrl = getActiveRpcUrl(settings);
  validateRpcUrl(rpcUrl);

  const [rpcFees, jitoFloor] = await Promise.all([
    rpcRequest<Array<{ prioritizationFee?: number }>>(rpcUrl, 'getRecentPrioritizationFees', []),
    settings.sendMode === 'jito' ? fetchJitoTipFloor(settings.jitoEndpoint).catch(() => null) : Promise.resolve(null)
  ]);

  const microLamportsPerCu = rpcFees
    .map((item) => Number(item.prioritizationFee ?? 0))
    .filter((fee) => Number.isFinite(fee) && fee > 0)
    .sort((a, b) => a - b);

  const percentile = settings.autoFeeLevel === 'turbo' ? 0.95 : settings.autoFeeLevel === 'fast' ? 0.85 : 0.7;
  const sampledMicroLamports = microLamportsPerCu.length ? microLamportsPerCu[Math.min(microLamportsPerCu.length - 1, Math.floor((microLamportsPerCu.length - 1) * percentile))] : 1_250_000;
  const floorMicroLamports = settings.autoFeeLevel === 'turbo' ? 7_500_000 : settings.autoFeeLevel === 'fast' ? 3_000_000 : 1_250_000;
  const targetMicroLamports = Math.max(sampledMicroLamports, floorMicroLamports);
  const targetLamports = Math.ceil((AUTO_FEE_COMPUTE_UNIT_ESTIMATE * targetMicroLamports) / 1_000_000);
  const cappedTotalLamports = Math.min(Math.round(settings.autoFeeMax * LAMPORTS_PER_SOL), targetLamports);

  let jitoTipLamports = 0;
  if (settings.sendMode === 'jito') {
    const liveFloorLamports = jitoFloor ?? 0;
    const derivedTipLamports = Math.round(cappedTotalLamports * 0.35);
    jitoTipLamports = Math.min(
      Math.max(derivedTipLamports, liveFloorLamports),
      Math.round(0.003 * LAMPORTS_PER_SOL)
    );
  }
  const priorityLamports = Math.max(1, cappedTotalLamports - jitoTipLamports);

  return {
    priorityFeeSol: priorityLamports / LAMPORTS_PER_SOL,
    jitoTipSol: jitoTipLamports / LAMPORTS_PER_SOL
  };
}

async function fetchJitoTipFloor(jitoEndpoint: string): Promise<number> {
  const base = jitoEndpoint.replace('/api/v1/transactions', '');
  const url = `${base}/api/v1/bundles/tip_floor`;
  const data = await fetchJson<Array<{ landed_tips_50th_percentile?: number; landed_tips_75th_percentile?: number; landed_tips_95th_percentile?: number }>>(url);
  const tip = Array.isArray(data) && data[0] ? (data[0].landed_tips_75th_percentile ?? data[0].landed_tips_50th_percentile ?? 0) : 0;
  return Math.round(tip * LAMPORTS_PER_SOL);
}

function shouldAddJitoTip(settings: TradeSettings) {
  return settings.sendMode === 'jito' && Number.isFinite(settings.jitoTip) && settings.jitoTip > 0;
}

async function buildJupiterSwapInstructions(request: TradeRequest, quote: unknown, feeRecipient: string | null, feeLamports: bigint) {
  const feeAccount = feeRecipient && request.side === 'sell' ? getAssociatedTokenAddress(SOL_MINT, feeRecipient) : undefined;
  const response = await fetchJson<JupiterSwapInstructionsResponse>(JUPITER_SWAP_INSTRUCTIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: request.wallet,
      feeAccount,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: request.settings.priorityFee > 0 ? Math.round(request.settings.priorityFee * LAMPORTS_PER_SOL) : undefined
    })
  });

  const payer = new PublicKey(request.wallet);
  const treasury = feeRecipient ? new PublicKey(feeRecipient) : null;
  const jitoTipInstruction = createJitoTipInstruction(payer, request.settings);
  const computeBudgetInstructions = response.computeBudgetInstructions ?? [];
  const setupInstructions = response.setupInstructions ?? [];
  const addressLookupTableAddresses = response.addressLookupTableAddresses ?? [];
  const instructions = [
    ...computeBudgetInstructions.map(decodeJupiterInstruction),
    ...(jitoTipInstruction ? [jitoTipInstruction] : []),
    ...(treasury && request.side === 'buy' && feeLamports > 0n ? [SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: Number(feeLamports) })] : []),
    ...(treasury && request.side === 'sell' ? [createAssociatedTokenAccountIdempotentInstruction(payer, new PublicKey(feeAccount as string), treasury, new PublicKey(SOL_MINT))] : []),
    ...setupInstructions.map(decodeJupiterInstruction),
    decodeJupiterInstruction(response.swapInstruction),
    ...(response.cleanupInstruction ? [decodeJupiterInstruction(response.cleanupInstruction)] : [])
  ];
  const lookupTables = await loadAddressLookupTables(getActiveRpcUrl(request.settings), addressLookupTableAddresses);
  const blockhash = await rpcRequest<{ value: { blockhash: string; lastValidBlockHeight: number } }>(getActiveRpcUrl(request.settings), 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash.value.blockhash, instructions }).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);

  return { swapTransaction: bytesToBase64(transaction.serialize()), lastValidBlockHeight: blockhash.value.lastValidBlockHeight };
}

async function getJupiterSellAmount(request: TradeRequest) {
  const token = await getTokenBalance(request);
  if (token.rawAmount <= 0n) throw new Error('No token balance available to sell');
  const sellBps = BigInt(Math.round(request.amount * 100));
  const rawAmount = (token.rawAmount * sellBps) / 10_000n;
  if (rawAmount <= 0n) throw new Error('Sell amount is below token precision');
  return rawAmount.toString();
}

async function getPosition(request: PositionRequest): Promise<PositionResponse> {
  if (!isPublicKeyString(request.wallet)) throw new Error('Wallet not connected');
  validateRpcUrl(getActiveRpcUrl(request.settings));

  const balance = await rpcRequest<{ value?: number } | number>(getActiveRpcUrl(request.settings), 'getBalance', [request.wallet, { commitment: 'processed' }]);
  const lamports = typeof balance === 'number' ? balance : balance.value ?? 0;
  const token = request.mint && isPublicKeyString(request.mint) ? await getTokenBalance(request) : { amount: 0, rawAmount: 0n, decimals: 0 };
  const wsol = await getTokenBalance({ ...request, mint: SOL_MINT });

  return {
    ok: true,
    walletSol: lamports / LAMPORTS_PER_SOL,
    walletWsol: wsol.amount,
    tokenAmount: token.amount,
    tokenRawAmount: token.rawAmount.toString(),
    tokenDecimals: token.decimals
  };
}

async function getTokenBalance(request: Pick<PositionRequest, 'wallet' | 'mint' | 'settings'>) {
  const response = await rpcRequest<TokenAccountsByOwnerResponse>(getActiveRpcUrl(request.settings), 'getTokenAccountsByOwner', [
    request.wallet,
    { mint: request.mint },
    { encoding: 'jsonParsed', commitment: 'processed' }
  ]);
  const accounts = response.value ?? [];
  let amount = 0;
  let rawAmount = 0n;
  let decimals = 0;

  for (const account of accounts) {
    const tokenAmount = account.account.data.parsed.info.tokenAmount;
    amount += Number(tokenAmount.uiAmount ?? 0);
    rawAmount += BigInt(tokenAmount.amount);
    decimals = tokenAmount.decimals;
  }

  return { amount, rawAmount, decimals };
}

async function signAndSendLocal(request: SignAndSendLocalRequest): Promise<TradeResponse> {
  const wallet = await getUnlockedHotWallet();
  if (request.settings.localWalletPublicKey && wallet.publicKey.toBase58() !== request.settings.localWalletPublicKey) {
    throw new Error('Unlocked hot wallet does not match selected local pubkey');
  }
  const transaction = VersionedTransaction.deserialize(base64ToBytes(request.transaction));
  transaction.sign([wallet]);
  return sendSignedTransaction({ type: 'TRENCH_SEND_SIGNED_TRANSACTION', signedTransaction: bytesToBase64(transaction.serialize()), settings: request.settings });
}

const PUMP_AMM_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_SWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

async function isPumpSwapToken(mint: string, rpcUrl: string): Promise<boolean> {
  try {
    const response = await rpcRequest<{ value: Array<{ account: { owner: string } }> }>(rpcUrl, 'getProgramAccounts', [
      PUMP_SWAP_PROGRAM,
      {
        encoding: 'base64',
        filters: [
          { memcmp: { offset: 8, bytes: mint } }
        ]
      }
    ]);
    return Array.isArray(response.value) && response.value.length > 0;
  } catch {
    return false;
  }
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
  if (request.settings.sendMode === 'jito') return sendJitoTransaction(request);

  validateRpcUrl(getActiveRpcUrl(request.settings));

  const result = await fetchJson<{ result?: string; error?: { message?: string } }>(getActiveRpcUrl(request.settings), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'trench-send',
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

async function sendJitoTransaction(request: SendSignedTransactionRequest): Promise<TradeResponse> {
  validateJitoUrl(request.settings.jitoEndpoint);

  const url = new URL(request.settings.jitoEndpoint);
  if (request.settings.jitoBundleOnly) url.searchParams.set('bundleOnly', 'true');

  const result = await fetchJson<{ result?: string; error?: { message?: string } }>(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'trench-jito-send',
      method: 'sendTransaction',
      params: [
        request.signedTransaction,
        {
          encoding: 'base64'
        }
      ]
    })
  });

  if (result.error) throw new Error(result.error.message ?? 'Jito send failed');
  if (!result.result) throw new Error('Jito returned no signature');

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
  if (!['normal', 'fast', 'turbo'].includes(settings.autoFeeLevel)) throw new Error('Invalid auto fee level');
  if (!Number.isFinite(settings.autoFeeMax) || settings.autoFeeMax < 0.0001 || settings.autoFeeMax > MAX_PRIORITY_FEE_SOL) {
    throw new Error(`Auto fee max must be between 0.0001 and ${MAX_PRIORITY_FEE_SOL} SOL`);
  }
  validateRpcUrl(getActiveRpcUrl(settings));
  validateJitoUrl(settings.jitoEndpoint);
  getTrenchFeeRecipient(settings);
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
  return hostname === 'api.mainnet-beta.solana.com' || hostname === 'mainnet.helius-rpc.com' || hostname === 'rpc.shyft.to' || hostname === 'rpc.trench.trade' || hostname.endsWith('.helius-rpc.com') || hostname.endsWith('.quiknode.pro') || hostname.endsWith('.trench.trade');
}

function validateJitoUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid Jito endpoint');
  }

  if (url.protocol !== 'https:') throw new Error('Jito endpoint must use HTTPS');
  if (!url.hostname.endsWith('.block-engine.jito.wtf')) throw new Error('Jito endpoint is not allowed');
  if (url.pathname !== '/api/v1/transactions') throw new Error('Jito endpoint must use /api/v1/transactions');
}

function isPublicKeyString(value: string | null | undefined) {
  return typeof value === 'string' && PUBLIC_KEY_PATTERN.test(value);
}

function isHotWalletRequest(request: { type?: string }) {
  return typeof request.type === 'string' && request.type.startsWith('TRENCH_HOT_WALLET_');
}

async function handleHotWalletRequest(request: HotWalletRequest): Promise<HotWalletResponse> {
  if (request.type === 'TRENCH_HOT_WALLET_STATUS') return getHotWalletStatus();
  if (request.type === 'TRENCH_HOT_WALLET_IMPORT') return importHotWallet(request.secretKey, request.password);
  if (request.type === 'TRENCH_HOT_WALLET_UNLOCK') return unlockHotWallet(request.password);
  if (request.type === 'TRENCH_HOT_WALLET_LOCK') return lockHotWallet();
  if (request.type === 'TRENCH_HOT_WALLET_FORGET') return forgetHotWallet();
  return { ok: false, error: 'Unknown hot wallet request' };
}

async function getHotWalletStatus(): Promise<HotWalletResponse> {
  const stored = await chrome.storage.local.get(HOT_WALLET_STORAGE_KEY);
  const session = await chrome.storage.session.get(HOT_WALLET_SESSION_KEY);
  const encrypted = stored[HOT_WALLET_STORAGE_KEY] as EncryptedHotWallet | undefined;
  const unlocked = session[HOT_WALLET_SESSION_KEY] as HotWalletSession | undefined;
  return {
    ok: true,
    hasWallet: Boolean(encrypted),
    unlocked: Boolean(unlocked?.secretKey),
    publicKey: unlocked?.publicKey ?? encrypted?.publicKey
  };
}

async function importHotWallet(rawSecretKey: string, password: string): Promise<HotWalletResponse> {
  const secretKey = parseSecretKey(rawSecretKey);
  const wallet = Keypair.fromSecretKey(secretKey);
  const encrypted = await encryptSecretKey(secretKey, password);
  const publicKey = wallet.publicKey.toBase58();

  await chrome.storage.local.set({ [HOT_WALLET_STORAGE_KEY]: { ...encrypted, publicKey } });
  await chrome.storage.session.set({ [HOT_WALLET_SESSION_KEY]: { secretKey: Array.from(secretKey), publicKey } });
  await setLocalSigner(publicKey);
  return { ok: true, hasWallet: true, unlocked: true, publicKey };
}

async function unlockHotWallet(password: string): Promise<HotWalletResponse> {
  const stored = await chrome.storage.local.get(HOT_WALLET_STORAGE_KEY);
  const encrypted = stored[HOT_WALLET_STORAGE_KEY] as EncryptedHotWallet | undefined;
  if (!encrypted) throw new Error('No local hot wallet imported');

  const secretKey = await decryptSecretKey(encrypted, password);
  const wallet = Keypair.fromSecretKey(secretKey);
  const publicKey = wallet.publicKey.toBase58();
  await chrome.storage.session.set({ [HOT_WALLET_SESSION_KEY]: { secretKey: Array.from(secretKey), publicKey } });
  await setLocalSigner(publicKey);
  return { ok: true, hasWallet: true, unlocked: true, publicKey };
}

async function setLocalSigner(publicKey: string) {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = typeof stored[SETTINGS_KEY] === 'object' && stored[SETTINGS_KEY] !== null ? stored[SETTINGS_KEY] : {};
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, signerMode: 'local', localWalletPublicKey: publicKey } });
}

async function forgetHotWallet(): Promise<HotWalletResponse> {
  await chrome.storage.local.remove(HOT_WALLET_STORAGE_KEY);
  await chrome.storage.session.remove(HOT_WALLET_SESSION_KEY);
  return { ok: true, hasWallet: false, unlocked: false };
}

async function lockHotWallet(): Promise<HotWalletResponse> {
  const stored = await chrome.storage.local.get(HOT_WALLET_STORAGE_KEY);
  const encrypted = stored[HOT_WALLET_STORAGE_KEY] as EncryptedHotWallet | undefined;
  await chrome.storage.session.remove(HOT_WALLET_SESSION_KEY);
  return { ok: true, hasWallet: Boolean(encrypted), unlocked: false, publicKey: encrypted?.publicKey };
}

async function getUnlockedHotWallet() {
  const session = await chrome.storage.session.get(HOT_WALLET_SESSION_KEY);
  const wallet = session[HOT_WALLET_SESSION_KEY] as HotWalletSession | undefined;
  if (!wallet?.secretKey) throw new Error('Local hot wallet is locked');
  return Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
}

type EncryptedHotWallet = {
  publicKey: string;
  cipherText: number[];
  iv: number[];
  salt: number[];
};

type HotWalletSession = {
  publicKey: string;
  secretKey: number[];
};

type TokenAccountsByOwnerResponse = {
  value?: Array<{
    account: {
      data: {
        parsed: {
          info: {
            tokenAmount: {
              amount: string;
              decimals: number;
              uiAmount: number | null;
            };
          };
        };
      };
    };
  }>;
};

type JupiterInstruction = {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
};

type JupiterSwapInstructionsResponse = {
  computeBudgetInstructions?: JupiterInstruction[];
  setupInstructions?: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  cleanupInstruction?: JupiterInstruction;
  addressLookupTableAddresses?: string[];
};

function parseSecretKey(value: string) {
  const trimmed = value.trim();
  const rawBytes = parseSecretKeyBytes(trimmed);
  if (!rawBytes) throw new Error('Secret key must be base58, hex, comma/space bytes, JSON array, or an object with secretKey');
  if (![32, 64].includes(rawBytes.length)) throw new Error('Secret key must contain 32 seed bytes or 64 keypair bytes');
  const bytes = rawBytes.map((item) => Number(item));
  if (bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) throw new Error('Secret key bytes must be 0-255');
  const keyBytes = Uint8Array.from(bytes);
  return keyBytes.length === 32 ? Keypair.fromSeed(keyBytes).secretKey : keyBytes;
}

function parseSecretKeyBytes(trimmed: string): unknown[] | null {
  const jsonBytes = parseJsonSecretKey(trimmed);
  if (jsonBytes) return jsonBytes;

  const bracketMatch = trimmed.match(/\[([\s\S]+)]/);
  if (bracketMatch) return parseDelimitedBytes(bracketMatch[1]);

  const delimited = parseDelimitedBytes(trimmed);
  if (delimited) return delimited;

  const hex = parseHexBytes(trimmed);
  if (hex) return Array.from(hex);

  const base58 = parseBase58Bytes(trimmed);
  return base58 ? Array.from(base58) : null;
}

function parseJsonSecretKey(trimmed: string): unknown[] | null {
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'string') return parseSecretKeyBytes(parsed);
    return Array.isArray(parsed) ? parsed : isSecretKeyObject(parsed) ? parsed.secretKey : null;
  } catch {
    return null;
  }
}

function parseDelimitedBytes(value: string) {
  if (!/^[\d\s,]+$/.test(value)) return null;
  const parts = value.split(/[\s,]+/).filter(Boolean);
  return parts.length ? parts.map((part) => Number(part)) : null;
}

function parseHexBytes(value: string) {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) return null;
  return Uint8Array.from(normalized.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function parseBase58Bytes(value: string) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return null;

  let numeric = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return null;
    numeric = numeric * 58n + BigInt(digit);
  }

  const bytes = [];
  while (numeric > 0n) {
    bytes.unshift(Number(numeric & 0xffn));
    numeric >>= 8n;
  }

  for (const char of value) {
    if (char !== '1') break;
    bytes.unshift(0);
  }

  return Uint8Array.from(bytes);
}

function isSecretKeyObject(value: unknown): value is { secretKey: unknown[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { secretKey?: unknown }).secretKey);
}

async function encryptSecretKey(secretKey: Uint8Array, password: string) {
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(secretKey));
  return { cipherText: Array.from(new Uint8Array(encrypted)), iv: Array.from(iv), salt: Array.from(salt) };
}

async function decryptSecretKey(wallet: EncryptedHotWallet, password: string) {
  const key = await deriveEncryptionKey(password, Uint8Array.from(wallet.salt));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(Uint8Array.from(wallet.iv)) }, key, toArrayBuffer(Uint8Array.from(wallet.cipherText)));
  return new Uint8Array(decrypted);
}

async function deriveEncryptionKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 250_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function fetchJupiterQuote(params: { inputMint: string; outputMint: string; amount: string; slippageBps: number; platformFeeBps?: number }) {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set('inputMint', params.inputMint);
  url.searchParams.set('outputMint', params.outputMint);
  url.searchParams.set('amount', String(params.amount));
  url.searchParams.set('slippageBps', String(params.slippageBps));
  if (params.platformFeeBps) url.searchParams.set('platformFeeBps', String(params.platformFeeBps));
  url.searchParams.set('onlyDirectRoutes', 'false');
  url.searchParams.set('asLegacyTransaction', 'false');

  return fetchJson<unknown>(url.toString());
}

function getTrenchFeeRecipient(settings: TradeRequest['settings']) {
  if (!usesTrenchRouting(settings)) return null;
  if (!isPublicKeyString(settings.trenchFeeRecipient)) throw new Error('Trench RPC mode requires a fee recipient public key');
  return settings.trenchFeeRecipient;
}

function getAssociatedTokenAddress(mint: string, owner: string) {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0].toBase58();
}

function decodeJupiterInstruction(instruction: JupiterInstruction) {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })),
    data: Buffer.from(base64ToBytes(instruction.data))
  });
}

function createAssociatedTokenAccountIdempotentInstruction(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isWritable: true, isSigner: true },
      { pubkey: ata, isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: false, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }
    ],
    data: Buffer.from(Uint8Array.of(CREATE_ATA_IDEMPOTENT_DISCRIMINATOR))
  });
}

async function loadAddressLookupTables(rpcUrl: string, addresses: string[]) {
  if (!addresses.length) return [];
  const response = await rpcRequest<{ value: Array<{ data?: [string, string]; executable: boolean; lamports: number; owner: string; rentEpoch: number } | null> }>(
    rpcUrl,
    'getMultipleAccounts',
    [addresses, { encoding: 'base64', commitment: 'confirmed' }]
  );

  return response.value.flatMap((account, index) => {
    if (!account?.data?.[0]) return [];
    return [new AddressLookupTableAccount({ key: new PublicKey(addresses[index]), state: AddressLookupTableAccount.deserialize(base64ToBytes(account.data[0])) })];
  });
}

function calculateTrenchFee(amountLamports: bigint) {
  return (amountLamports * BigInt(TRENCH_FEE_BPS)) / 10_000n;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as T & { error?: string | { message?: string }; message?: string };

  if (!response.ok) {
    throw new Error(readPayloadError(payload) ?? `HTTP ${response.status}`);
  }

  return payload as T;
}

async function rpcRequest<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const payload = await fetchJson<{ result?: T; error?: { message?: string } }>(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `trench-${method}`, method, params })
  });

  if (payload.error) throw new Error(payload.error.message ?? `${method} failed`);
  if (payload.result === undefined) throw new Error(`${method} returned no result`);
  return payload.result;
}

function readPayloadError(payload: { error?: string | { message?: string }; message?: string } | null) {
  if (!payload) return null;
  if (typeof payload.error === 'string') return payload.error;
  return payload.error?.message ?? payload.message ?? null;
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Tx failed';
}

const PNL_LEDGER_KEY = 'trench.pnl.v1';
const TRADE_HISTORY_KEY = 'trench.tradeHistory.v1';
const INDEX_HISTORY_LIMIT = 200;
const LAMPORTS_PER_SOL_NUM = 1_000_000_000;

type PnlLedger = {
  rawTokenAmount: string;
  costBasisSol: number;
  realizedPnlSol: number;
  updatedAt: number;
};

type StoredTradeOrder = {
  id: string;
  side: 'buy' | 'sell';
  mint: string | null;
  wallet: string;
  route?: 'pump' | 'jupiter';
  signature?: string;
  summary?: string;
  error?: string;
  size: string;
  status: 'Sent' | 'Failed';
  createdAt: number;
};

async function indexWalletHistory(request: IndexHistoryRequest): Promise<IndexHistoryResponse> {
  const { wallet, mint, settings } = request;
  const rpcUrl = getActiveRpcUrl(settings);

  const signaturesResult = await rpcRequest<Array<{ signature: string; err: unknown }>>(rpcUrl, 'getSignaturesForAddress', [
    wallet,
    { limit: INDEX_HISTORY_LIMIT, commitment: 'confirmed' }
  ]);

  const successfulSigs = signaturesResult.filter((s) => !s.err).map((s) => s.signature);
  if (successfulSigs.length === 0) {
    return { ok: true, scanned: 0, matched: 0, costBasisSol: 0, realizedPnlSol: 0 };
  }

  let costBasisSol = 0;
  let realizedPnlSol = 0;
  let matched = 0;
  const historyEntries: StoredTradeOrder[] = [];

  for (const sig of successfulSigs) {
    try {
      const tx = await rpcRequest<TxResponse | null>(rpcUrl, 'getTransaction', [
        sig,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }
      ]);
      if (!tx?.meta) continue;

      const result = classifySwapTx(tx, wallet, mint);
      if (!result) continue;

      matched++;

      if (result.side === 'buy') {
        costBasisSol += result.solDelta;
      } else {
        realizedPnlSol += result.solDelta - (result.solDelta / (1 + realizedPnlSol / Math.max(costBasisSol, 0.000001)));
      }

      historyEntries.push({
        id: sig,
        side: result.side,
        mint,
        wallet,
        route: result.route,
        signature: sig,
        summary: result.side === 'buy'
          ? `Buy ${result.solDelta.toFixed(4)} SOL (indexed)`
          : `Sell ${Math.abs(result.solDelta).toFixed(4)} SOL (indexed)`,
        size: result.solDelta.toFixed(4),
        status: 'Sent',
        createdAt: (tx.blockTime ?? 0) * 1000
      });
    } catch {
      // skip undecodeable tx
    }
  }

  if (matched > 0) {
    const ledger: PnlLedger = {
      rawTokenAmount: '0',
      costBasisSol,
      realizedPnlSol,
      updatedAt: Date.now()
    };
    await chrome.storage.local.set({ [`${PNL_LEDGER_KEY}:${wallet}:${mint}`]: ledger });

    const pnlStore = await chrome.storage.local.get(PNL_LEDGER_KEY);
    const existingStore = (pnlStore[PNL_LEDGER_KEY] as Record<string, PnlLedger> | undefined) ?? {};
    await chrome.storage.local.set({ [PNL_LEDGER_KEY]: { ...existingStore, [`${wallet}:${mint}`]: ledger } });

    const stored = await chrome.storage.local.get(TRADE_HISTORY_KEY);
    const existing = (stored[TRADE_HISTORY_KEY] as StoredTradeOrder[] | undefined) ?? [];
    const existingSigs = new Set(existing.map((e) => e.id));
    const newEntries = historyEntries.filter((e) => !existingSigs.has(e.id));
    if (newEntries.length > 0) {
      await chrome.storage.local.set({ [TRADE_HISTORY_KEY]: [...newEntries, ...existing].slice(0, 500) });
    }
  }

  return { ok: true, scanned: successfulSigs.length, matched, costBasisSol, realizedPnlSol };
}

type TxResponse = {
  blockTime?: number;
  meta: {
    preTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount: { amount: string } }>;
    postTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount: { amount: string } }>;
    preBalances: number[];
    postBalances: number[];
  };
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string }>;
    };
  };
};

function classifySwapTx(
  tx: TxResponse,
  wallet: string,
  mint: string
): { side: 'buy' | 'sell'; solDelta: number; route: 'pump' | 'jupiter' } | null {
  const accounts = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const walletIndex = accounts.indexOf(wallet);
  if (walletIndex === -1) return null;

  const pre = tx.meta.preTokenBalances ?? [];
  const post = tx.meta.postTokenBalances ?? [];

  const preToken = pre.find((b) => b.mint === mint && accounts[b.accountIndex]?.startsWith(wallet.slice(0, 8)));
  const postToken = post.find((b) => b.mint === mint && accounts[b.accountIndex]?.startsWith(wallet.slice(0, 8)));

  const preAmt = BigInt(preToken?.uiTokenAmount.amount ?? '0');
  const postAmt = BigInt(postToken?.uiTokenAmount.amount ?? '0');
  const tokenDelta = postAmt - preAmt;
  if (tokenDelta === 0n) return null;

  const preSol = tx.meta.preBalances[walletIndex] ?? 0;
  const postSol = tx.meta.postBalances[walletIndex] ?? 0;
  const solDelta = Math.abs((postSol - preSol) / LAMPORTS_PER_SOL_NUM);
  if (solDelta < 0.000001) return null;

  const isJupiter = accounts.some((a) => a === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  const isPump = accounts.some((a) => a === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const route: 'pump' | 'jupiter' = isPump ? 'pump' : isJupiter ? 'jupiter' : 'jupiter';

  return { side: tokenDelta > 0n ? 'buy' : 'sell', solDelta, route };
}
