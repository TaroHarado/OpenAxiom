import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { EvmAccountsRequest, EvmAccountsResponse, EvmBatchTradeRequest, EvmBatchTradeResponse, EvmPrewarmRouteRequest, EvmTradeRequest, EvmTradeResponse, TradeSide } from './types';
import { resolveDopplerPoolKey, resolveDopplerRoute, type DopplerRoute, type DopplerPoolKey } from './evmDoppler';
import { resolveNativeV4Route, type NativeV4Route } from './evmV4Pool';
import { selectBestV3Pool } from './evmV3Pool';
import { decodeVirtualsReserves, quoteVirtualsBuy, quoteVirtualsSell } from './evmVirtuals';
import { addVaultAccount, createEmptyVault, createSerialQueue, legacyAddressMatches, mergeLegacyVaultAccount, normalizeVault, preparePasswordVaultMigration, removeVaultAccount, setActiveVaultAccount, setSelectedVaultAccounts, type EvmAccountRecord, type EvmAccountVault } from './evmAccounts';

declare const chrome: {
  runtime: {
    id: string;
    onMessage: {
      addListener: (
        callback: (message: unknown, sender: ChromeMessageSender, sendResponse: (response: unknown) => void) => boolean | void
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

type ChromeMessageSender = {
  id?: string;
  url?: string;
  tab?: { url?: string };
};

const EVM_WALLET_STORAGE_KEY = 'trench.evmWallet.v1';
const EVM_WALLET_SESSION_KEY = 'trench.evmWallet.session.v1';
const EVM_ACCOUNTS_STORAGE_KEY = 'trench.evmAccounts.v2';
const EVM_LEGACY_MIGRATION_KEY = 'trench.evmLegacyMigration.v1';
const EVM_VAULT_SECURITY_KEY = 'trench.evmVaultSecurity.v1';
const EVM_VAULT_SESSION_KEY = 'trench.evmVaultKey.session.v1';
const EVM_PASSWORD_VAULT_ARCHIVE_KEY = 'trench.evmPasswordVaultArchive.v1';
const EVM_PASSWORD_VAULT_ARCHIVED_FLAG = 'trench.evmPasswordVaultArchived.v1';
const EVM_SUBMISSION_JOURNAL_KEY = 'trench.evmSubmissionJournal.v1';
const RH_CHAIN_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const RH_CHAIN_ID = 4663n;
const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const WETH_ADDRESS = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const UNISWAP_V3_ROUTER = '0xcaf681a66d020601342297493863e78c959e5cb2';
const UNISWAP_V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const VIRTUAL_ADDRESS = '0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31';
const VIRTUALS_PAIR_FACTORY = '0xFC2E4Da3EdB2E18100473339c763705d263D20A9';
const VIRTUALS_SWAP_ROUTER = '0x65050A9b7E5075A2bA5cED7b1b64EE66262c40Dc';
const WETH_VIRTUAL_PAIR = '0xd95e8e2Cd04c207625C6F23c974d365a5F3A91D3';
const FLAP_PORTAL = '0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09';
const UFC_ADDRESS = '0x342a2e3fe8b3f70189216910d936316294df7777';
const DART_ADDRESS = '0x693d17bd4fc192415f7678548ae3c807873f7857';
const V4_QUOTER = '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94';
const V4_POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const DART_HOOK = '0x745d717620052a97a22dEEE2e5Eba59583f3e0CC';
const ALLOWANCE_HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const ROBINHOOD_SETTLER = '0xe72688F7d25D7318B9A81F21EdDa640CA948c83B';
const NATIVE_TOKEN_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const DART_V4_FILLS = '0x271000000000000000000000000000000001000276a401693d17bd4fc192415f7678548ae3c807873f78570000000000c8745d717620052a97a22deee2e5eba59583f3e0cc000000';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as `0x${string}`;
const FEE_TIERS = [500, 100, 3000, 10000];
const MAX_EVM_BUY_ETH = 100;
const MAX_EVM_SLIPPAGE_BPS = 5_000;
const ROUTE_CACHE_TTL_MS = 10_000;
const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RH_CHAIN_RPC] }, public: { http: [RH_CHAIN_RPC] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});
const publicEvmClient = createPublicClient({ chain: robinhoodChain, transport: http(RH_CHAIN_RPC), pollingInterval: 250 });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const request = message as Partial<EvmTradeRequest | EvmAccountsRequest | EvmBatchTradeRequest | EvmPrewarmRouteRequest>;
  const requestType = (message as { type?: string }).type;

  if (!isAuthorizedRobinhoodSender(requestType, sender)) {
    sendResponse({ ok: false, error: 'Unauthorized extension request' });
    return false;
  }

  if (requestType === 'TRENCH_RUNTIME_PING') {
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === 'TRENCH_EVM_PREWARM_ROUTE') {
    prewarmEvmBuyRoute(request as EvmPrewarmRouteRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (request.type === 'TRENCH_EVM_TRADE') {
    const receivedAt = performance.now();
    queueEvmTrade(request as EvmTradeRequest)
      .then(sendResponse)
      .catch((error: unknown) => {
        const message = normalizeError(error);
        console.error(`[EVM trade] ${new Date().toISOString()} +${Math.round(performance.now() - receivedAt)}ms trade-failed`, {
          side: request.side,
          token: request.tokenAddress,
          error: message,
        });
        sendResponse({ ok: false, error: message });
      });
    return true;
  }

  if (request.type === 'TRENCH_EVM_BATCH_TRADE') {
    handleEvmBatchTrade(request as EvmBatchTradeRequest)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, results: [], error: normalizeError(error) }));
    return true;
  }

  if (typeof request.type === 'string' && request.type.startsWith('TRENCH_EVM_ACCOUNT')) {
    evmVaultQueue(() => handleEvmAccountsRequest(request as EvmAccountsRequest))
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, accounts: [], activeAccountId: null, selectedAccountIds: [], error: normalizeError(error) }));
    return true;
  }

  sendResponse({ ok: false, error: 'Unsupported extension request' });
  return false;
});

function isAuthorizedRobinhoodSender(requestType: string | undefined, sender: ChromeMessageSender) {
  if (!requestType || sender.id !== chrome.runtime.id) return false;
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
  const senderUrl = sender.url ?? sender.tab?.url ?? '';
  const fromExtensionPage = senderUrl.startsWith(extensionOrigin);
  const fromGmgnContent = sender.tab?.url?.startsWith('https://gmgn.ai/') === true;
  if (requestType === 'TRENCH_EVM_ACCOUNT_CREATE' || requestType === 'TRENCH_EVM_ACCOUNT_IMPORT' || requestType === 'TRENCH_EVM_ACCOUNT_EXPORT' || requestType === 'TRENCH_EVM_ACCOUNT_REMOVE' || requestType === 'TRENCH_EVM_ACCOUNT_RENAME') {
    return fromExtensionPage;
  }
  return fromExtensionPage || fromGmgnContent;
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Tx failed';
}

// ─── EVM / Robinhood Chain ────────────────────────────────────────────────────

async function evmRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RH_CHAIN_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json() as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'RPC error');
  return json.result;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function encodeUint256(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

function encodeAddress(addr: string): string {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

function encodeExactInputSingle(params: {
  tokenIn: string; tokenOut: string; fee: number; recipient: string;
  deadline: bigint; amountIn: bigint; amountOutMinimum: bigint; sqrtPriceLimitX96: bigint;
}): string {
  const selector = '0x414bf389';
  return selector
    + encodeAddress(params.tokenIn)
    + encodeAddress(params.tokenOut)
    + encodeUint256(BigInt(params.fee))
    + encodeAddress(params.recipient)
    + encodeUint256(params.deadline)
    + encodeUint256(params.amountIn)
    + encodeUint256(params.amountOutMinimum)
    + encodeUint256(params.sqrtPriceLimitX96);
}

function encodeApprove(spender: string, amount: bigint): string {
  return '0x095ea7b3' + encodeAddress(spender) + encodeUint256(amount);
}

function encodeBalanceOf(owner: string): string {
  return '0x70a08231' + encodeAddress(owner);
}

function encodeAllowance(owner: string, spender: string): string {
  return '0xdd62ed3e' + encodeAddress(owner) + encodeAddress(spender);
}

async function evmCall(to: string, data: string): Promise<string> {
  return evmRpc('eth_call', [{ to, data }, 'latest']) as Promise<string>;
}

async function getEvmNonce(address: string): Promise<bigint> {
  const n = await evmRpc('eth_getTransactionCount', [address, 'latest']);
  return BigInt(n as string);
}

async function getEvmGasPrice(): Promise<bigint> {
  const p = await evmRpc('eth_gasPrice', []);
  return BigInt(p as string);
}

function encodeGetPool(tokenA: string, tokenB: string, fee: number): string {
  return '0x1698ee82'
    + tokenA.slice(2).toLowerCase().padStart(64, '0')
    + tokenB.slice(2).toLowerCase().padStart(64, '0')
    + fee.toString(16).padStart(64, '0');
}

function encodeGetPair(tokenA: string, tokenB: string): string {
  return '0xe6a43905'
    + tokenA.slice(2).toLowerCase().padStart(64, '0')
    + tokenB.slice(2).toLowerCase().padStart(64, '0');
}

async function findVirtualsPool(token: string): Promise<string | null> {
  const result = await evmCall(VIRTUALS_PAIR_FACTORY, encodeGetPair(VIRTUAL_ADDRESS, token));
  const pool = `0x${result.slice(-40)}`;
  return pool.toLowerCase() === ZERO_ADDRESS ? null : pool;
}

async function findBestDirectPool(tokenA: string, tokenB: string): Promise<{ pool: string; fee: number } | null> {
  // Uniswap V3 Factory.getPool requires token0 < token1 (numeric sort)
  const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB] : [tokenB, tokenA];
  const candidates = await Promise.all(FEE_TIERS.map(async (fee) => {
    const data = encodeGetPool(t0, t1, fee);
    let pool: string;
    try {
      pool = '0x' + ((await evmCall(UNISWAP_V3_FACTORY, data)) as string).slice(26);
    } catch {
      return null;
    }
    if (pool.toLowerCase() === ZERO_ADDRESS) return null;
    let liq = 1n; // pool exists; assume usable if liquidity() read fails
    try {
      const liqHex = await evmCall(pool, '0x1a686502');
      liq = BigInt(liqHex as string);
    } catch {
      /* keep liq = 1n so an existing pool is not discarded on a flaky RPC read */
    }
    return { pool, fee, liquidity: liq };
  }));
  return selectBestV3Pool(candidates.filter((candidate) => candidate !== null));
}

type SwapRoute =
  | { type: 'direct'; fee: number }
  | { type: 'multihop'; path: `0x${string}` }
  | { type: 'virtuals'; pool: string }
  | { type: 'doppler-v4'; poolKey: DopplerPoolKey }
  | NativeV4Route
  | DopplerRoute;

type CachedSwapRoute = {
  route?: SwapRoute;
  expiresAt: number;
  pending?: Promise<SwapRoute>;
};

const swapRouteCache = new Map<string, CachedSwapRoute>();

async function resolveSwapRoute(tokenIn: string, tokenOut: string): Promise<SwapRoute> {
  const [direct, doppler] = await Promise.all([
    findBestDirectPool(tokenIn, tokenOut),
    resolveDopplerRoute(tokenIn, tokenOut, evmCall).catch(() => null),
  ]);
  if (direct) return { type: 'direct', fee: direct.fee };
  if (doppler) return doppler;

  // Bonding-curve tokens settle against USDG through their validated Doppler V4 key.
  // The input WETH leg is separately discovered as a standard V3 pool below.
  if (tokenIn.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
    const poolKey = await resolveDopplerPoolKey(tokenOut, evmCall).catch(() => null);
    if (poolKey && [poolKey.currency0.toLowerCase(), poolKey.currency1.toLowerCase()].includes(USDG_ADDRESS.toLowerCase())) {
      return { type: 'doppler-v4', poolKey };
    }
  }

  if (tokenIn.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
    const nativeV4 = await resolveNativeV4Route(ZERO_ADDRESS, tokenOut, evmCall).catch(() => null);
    if (nativeV4) return nativeV4;
  }

  if (tokenIn.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
    const virtualsPool = await findVirtualsPool(tokenOut);
    if (virtualsPool) return { type: 'virtuals', pool: virtualsPool };
  }
  if (tokenOut.toLowerCase() === USDG_ADDRESS.toLowerCase()) {
    const virtualsPool = await findVirtualsPool(tokenIn);
    if (virtualsPool) return { type: 'virtuals', pool: virtualsPool };
  }

  for (const bridge of [WETH_ADDRESS, USDG_ADDRESS]) {
    if (bridge.toLowerCase() === tokenIn.toLowerCase() || bridge.toLowerCase() === tokenOut.toLowerCase()) continue;
    const legIn = await findBestDirectPool(tokenIn, bridge);
    const legOut = await findBestDirectPool(bridge, tokenOut);
    if (legIn && legOut) {
      const feeIn = legIn.fee.toString(16).padStart(6, '0');
      const feeOut = legOut.fee.toString(16).padStart(6, '0');
      const path = ('0x'
        + tokenIn.slice(2).toLowerCase()
        + feeIn
        + bridge.slice(2).toLowerCase()
        + feeOut
        + tokenOut.slice(2).toLowerCase()) as `0x${string}`;
      return { type: 'multihop', path };
    }
  }

  throw new Error(`No swap route found for ${tokenIn} → ${tokenOut}`);
}

function swapRouteCacheKey(tokenIn: string, tokenOut: string) {
  return `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
}

async function resolveCachedSwapRoute(tokenIn: string, tokenOut: string): Promise<SwapRoute> {
  const key = swapRouteCacheKey(tokenIn, tokenOut);
  const cached = swapRouteCache.get(key);
  if (cached?.route && cached.expiresAt > Date.now()) return cached.route;
  if (cached?.pending) return cached.pending;

  const entry: CachedSwapRoute = { expiresAt: 0 };
  entry.pending = resolveSwapRoute(tokenIn, tokenOut)
    .then((route) => {
      entry.route = route;
      entry.expiresAt = Date.now() + ROUTE_CACHE_TTL_MS;
      entry.pending = undefined;
      return route;
    })
    .catch((error) => {
      if (swapRouteCache.get(key) === entry) swapRouteCache.delete(key);
      throw error;
    });
  swapRouteCache.set(key, entry);
  return entry.pending;
}

async function prewarmEvmBuyRoute(req: EvmPrewarmRouteRequest) {
  const tokenAddress = req.tokenAddress?.trim().toLowerCase();
  if (!tokenAddress || !/^0x[0-9a-f]{40}$/.test(tokenAddress)) throw new Error('Invalid tokenAddress');
  const route = await resolveCachedSwapRoute(
    req.side === 'sell' ? tokenAddress : WETH_ADDRESS,
    req.side === 'sell' ? USDG_ADDRESS : tokenAddress,
  );
  return { ok: true, route: route.type };
}

async function getEvmDeviceKey(): Promise<CryptoKey> {
  const stored = (await chrome.storage.local.get(['trench.evmDeviceKey.v1']))['trench.evmDeviceKey.v1'] as string | undefined;
  if (stored) {
    const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  await chrome.storage.local.set({ 'trench.evmDeviceKey.v1': b64 });
  return key;
}

async function evmEncrypt(plaintext: string): Promise<string> {
  const key = await getEvmDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function evmDecrypt(encoded: string): Promise<string> {
  const key = await getEvmDeviceKey();
  return decryptEvmValue(encoded, key);
}

async function encryptEvmValue(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decryptEvmValue(encoded: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

type EvmVaultSecurity = { version: 1; salt: string; verifier: string; iterations: number };
type EvmPasswordVaultArchive = {
  version: 1;
  archivedAt: number;
  disposition: 'migrated' | 'session-unavailable';
  security: EvmVaultSecurity;
  vault: EvmAccountVault;
};

async function loadEvmVaultSecurity(): Promise<EvmVaultSecurity | null> {
  const stored = (await chrome.storage.local.get([EVM_VAULT_SECURITY_KEY]))[EVM_VAULT_SECURITY_KEY] as EvmVaultSecurity | undefined;
  return stored?.version === 1 ? stored : null;
}

async function getLegacyEvmVaultSessionKey(): Promise<CryptoKey | null> {
  const session = (await chrome.storage.session.get([EVM_VAULT_SESSION_KEY]))[EVM_VAULT_SESSION_KEY] as { key?: string; expiresAt?: number } | undefined;
  if (!session?.key || !session.expiresAt || session.expiresAt <= Date.now()) {
    return null;
  }
  const raw = Uint8Array.from(atob(session.key), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function migratePasswordVaultToDeviceKey() {
  const security = await loadEvmVaultSecurity();
  if (!security) return;

  const stored = await chrome.storage.local.get([EVM_ACCOUNTS_STORAGE_KEY, EVM_PASSWORD_VAULT_ARCHIVE_KEY]);
  const passwordVault = normalizeVault((stored[EVM_ACCOUNTS_STORAGE_KEY] as EvmAccountVault | undefined)?.version === 2
    ? stored[EVM_ACCOUNTS_STORAGE_KEY] as EvmAccountVault
    : createEmptyVault());
  const existingArchive = stored[EVM_PASSWORD_VAULT_ARCHIVE_KEY] as EvmPasswordVaultArchive | undefined;
  const legacyKey = await getLegacyEvmVaultSessionKey();
  let migration = await preparePasswordVaultMigration(passwordVault);

  if (legacyKey) {
    try {
      if (await decryptEvmValue(security.verifier, legacyKey) !== 'trench-robinhood-vault-v1') throw new Error('Invalid legacy vault session');
      const deviceKey = await getEvmDeviceKey();
      migration = await preparePasswordVaultMigration(passwordVault, async (account) => {
        const privateKey = await decryptEvmValue(account.encryptedPrivateKey, legacyKey);
        if (privateKeyToAccount(privateKey as `0x${string}`).address.toLowerCase() !== account.address.toLowerCase()) {
          throw new Error(`Wallet verification failed for ${account.name}`);
        }
        return encryptEvmValue(privateKey, deviceKey);
      });
    } catch {
      migration = await preparePasswordVaultMigration(passwordVault);
    }
  }

  const archive: EvmPasswordVaultArchive = existingArchive?.version === 1 ? existingArchive : {
    version: 1,
    archivedAt: Date.now(),
    disposition: migration.disposition,
    security,
    vault: passwordVault,
  };
  await chrome.storage.local.set({
    [EVM_ACCOUNTS_STORAGE_KEY]: migration.activeVault,
    [EVM_PASSWORD_VAULT_ARCHIVE_KEY]: archive,
    [EVM_PASSWORD_VAULT_ARCHIVED_FLAG]: true,
    [EVM_VAULT_SECURITY_KEY]: null,
  });
  await chrome.storage.session.remove([EVM_VAULT_SESSION_KEY]);
}

class EvmLegacyRecoveryError extends Error {
  constructor(message: string, readonly vault: EvmAccountVault) {
    super(message);
  }
}

async function loadEvmVault(recoveryPrivateKey?: string): Promise<EvmAccountVault> {
  await migratePasswordVaultToDeviceKey();
  const stored = (await chrome.storage.local.get([EVM_ACCOUNTS_STORAGE_KEY]))[EVM_ACCOUNTS_STORAGE_KEY] as EvmAccountVault | undefined;
  let vault = stored?.version === 2 ? normalizeVault(stored) : createEmptyVault();

  const migration = await chrome.storage.local.get([EVM_LEGACY_MIGRATION_KEY]);
  if (migration[EVM_LEGACY_MIGRATION_KEY] === 'complete') return vault;

  const legacy = await chrome.storage.local.get([EVM_WALLET_STORAGE_KEY, 'trench.evmAddress.v1']);
  const encryptedPrivateKey = legacy[EVM_WALLET_STORAGE_KEY] as string | undefined;
  if (!encryptedPrivateKey) {
    await chrome.storage.local.set({ [EVM_LEGACY_MIGRATION_KEY]: 'complete' });
    return vault;
  }
  try {
    const session = (await chrome.storage.session.get([EVM_WALLET_SESSION_KEY]))[EVM_WALLET_SESSION_KEY] as string | undefined;
    const normalizedRecoveryKey = recoveryPrivateKey?.trim()
      ? (recoveryPrivateKey.trim().startsWith('0x') ? recoveryPrivateKey.trim() : `0x${recoveryPrivateKey.trim()}`)
      : '';
    if (normalizedRecoveryKey && !/^0x[0-9a-fA-F]{64}$/.test(normalizedRecoveryKey)) throw new Error('Invalid recovery private key');
    const recoveredFromSession = Boolean(session && /^0x[0-9a-fA-F]{64}$/.test(session));
    const recoveredFromInput = Boolean(normalizedRecoveryKey);
    const privateKey = recoveredFromInput ? normalizedRecoveryKey : recoveredFromSession ? session! : await evmDecrypt(encryptedPrivateKey);
    const address = privateKeyToAccount(privateKey as `0x${string}`).address;
    const expectedAddress = legacy['trench.evmAddress.v1'] as string | undefined;
    if (!legacyAddressMatches(expectedAddress, address)) throw new Error('Recovery key does not match the legacy wallet');
    vault = mergeLegacyVaultAccount(vault, {
      id: crypto.randomUUID(),
      name: 'Imported wallet',
      address,
      encryptedPrivateKey: recoveredFromSession || recoveredFromInput ? await evmEncrypt(privateKey) : encryptedPrivateKey,
      createdAt: Date.now(),
    });
    await saveEvmVault(vault);
    await chrome.storage.local.set({ [EVM_LEGACY_MIGRATION_KEY]: 'complete' });
    return vault;
  } catch (error) {
    throw new EvmLegacyRecoveryError(`Legacy Robinhood wallet recovery required: ${normalizeError(error)}`, vault);
  }
}

async function saveEvmVault(vault: EvmAccountVault) {
  await chrome.storage.local.set({ [EVM_ACCOUNTS_STORAGE_KEY]: normalizeVault(vault) });
}

function normalizeAccountName(name: string, fallback: string) {
  const value = name.trim().replace(/\s+/g, ' ').slice(0, 32);
  return value || fallback;
}

async function importEvmAccount(name: string, privateKey: string): Promise<{ vault: EvmAccountVault; account: EvmAccountRecord }> {
  let key = privateKey.trim();
  if (!key.startsWith('0x')) key = `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid EVM private key');
  const account = privateKeyToAccount(key as `0x${string}`);
  const migration = await chrome.storage.local.get([EVM_LEGACY_MIGRATION_KEY, EVM_WALLET_STORAGE_KEY]);
  const recoveringLegacy = migration[EVM_LEGACY_MIGRATION_KEY] !== 'complete' && Boolean(migration[EVM_WALLET_STORAGE_KEY]);
  const vault = await loadEvmVault(recoveringLegacy ? key : undefined);
  if (recoveringLegacy) {
    const recovered = vault.accounts.find((item) => item.address.toLowerCase() === account.address.toLowerCase());
    if (!recovered) throw new Error('Legacy wallet recovery failed');
    return { vault, account: recovered };
  }
  const record: EvmAccountRecord = {
    id: crypto.randomUUID(),
    name: normalizeAccountName(name, `Wallet ${vault.accounts.length + 1}`),
    address: account.address,
    encryptedPrivateKey: await evmEncrypt(key),
    createdAt: Date.now(),
  };
  const next = addVaultAccount(vault, record);
  await saveEvmVault(next);
  return { vault: next, account: record };
}

async function publicEvmAccounts(inputVault?: EvmAccountVault): Promise<EvmAccountsResponse> {
  let vault = inputVault;
  let recoveryError: EvmLegacyRecoveryError | null = null;
  if (!vault) {
    try {
      vault = await loadEvmVault();
    } catch (error) {
      if (!(error instanceof EvmLegacyRecoveryError)) throw error;
      vault = error.vault;
      recoveryError = error;
    }
  }
  const archived = (await chrome.storage.local.get([EVM_PASSWORD_VAULT_ARCHIVED_FLAG]))[EVM_PASSWORD_VAULT_ARCHIVED_FLAG] === true;
  return {
    ok: !recoveryError,
    activeAccountId: vault.activeAccountId,
    selectedAccountIds: vault.selectedAccountIds,
    accounts: vault.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      address: account.address,
      active: account.id === vault.activeAccountId,
      selected: vault.selectedAccountIds.includes(account.id),
      createdAt: account.createdAt,
    })),
    passwordVaultArchived: archived,
    legacyRecoveryRequired: Boolean(recoveryError),
    error: recoveryError?.message,
  };
}

async function handleEvmAccountsRequest(req: EvmAccountsRequest): Promise<EvmAccountsResponse> {
  if (req.type === 'TRENCH_EVM_ACCOUNTS_LIST') return publicEvmAccounts();
  if (req.type === 'TRENCH_EVM_ACCOUNT_CREATE') {
    const privateKey = generatePrivateKey();
    const { vault, account } = await importEvmAccount(req.name, privateKey);
    return { ...(await publicEvmAccounts(vault)), createdAccountId: account.id };
  }
  if (req.type === 'TRENCH_EVM_ACCOUNT_IMPORT') {
    const { vault, account } = await importEvmAccount(req.name, req.privateKey);
    return { ...(await publicEvmAccounts(vault)), createdAccountId: account.id };
  }
  if (req.type === 'TRENCH_EVM_ACCOUNT_EXPORT') {
    const { privateKey } = await getEvmAccountKey(req.accountId);
    return { ...(await publicEvmAccounts()), privateKey };
  }

  let vault = await loadEvmVault();
  if (req.type === 'TRENCH_EVM_ACCOUNT_RENAME') {
    if (!vault.accounts.some((account) => account.id === req.accountId)) throw new Error('Wallet not found');
    vault = normalizeVault({
      ...vault,
      accounts: vault.accounts.map((account) => account.id === req.accountId
        ? { ...account, name: normalizeAccountName(req.name, account.name) }
        : account),
    });
  } else if (req.type === 'TRENCH_EVM_ACCOUNT_REMOVE') {
    vault = removeVaultAccount(vault, req.accountId);
  } else if (req.type === 'TRENCH_EVM_ACCOUNT_SET_ACTIVE') {
    vault = setActiveVaultAccount(vault, req.accountId);
  } else if (req.type === 'TRENCH_EVM_ACCOUNTS_SET_SELECTED') {
    vault = setSelectedVaultAccounts(vault, req.accountIds);
  }
  await saveEvmVault(vault);
  return publicEvmAccounts(vault);
}

async function getEvmAccountKey(accountId?: string): Promise<{ record: EvmAccountRecord; privateKey: string }> {
  const vault = await loadEvmVault();
  const id = accountId ?? vault.activeAccountId;
  const record = vault.accounts.find((account) => account.id === id);
  if (!record) throw new Error('Select a Robinhood wallet first');
  const privateKey = await evmDecrypt(record.encryptedPrivateKey);
  const address = privateKeyToAccount(privateKey as `0x${string}`).address;
  if (address.toLowerCase() !== record.address.toLowerCase()) throw new Error('Wallet record verification failed');
  return { record, privateKey };
}

const evmVaultQueue = createSerialQueue();
const evmAccountQueues = new Map<string, Promise<unknown>>();

async function queueEvmTrade(req: EvmTradeRequest): Promise<EvmTradeResponse> {
  const { record } = await evmVaultQueue(() => getEvmAccountKey(req.accountId));
  const previous = evmAccountQueues.get(record.id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => handleEvmTrade({ ...req, accountId: record.id }));
  evmAccountQueues.set(record.id, current);
  try {
    return await current;
  } finally {
    if (evmAccountQueues.get(record.id) === current) evmAccountQueues.delete(record.id);
  }
}

async function handleEvmBatchTrade(req: EvmBatchTradeRequest): Promise<EvmBatchTradeResponse> {
  const vault = await evmVaultQueue(() => loadEvmVault());
  const accountIds = [...new Set(req.accountIds)].filter((id) => vault.accounts.some((account) => account.id === id)).slice(0, 10);
  if (!accountIds.length) throw new Error('Select at least one wallet');
  const results = [];
  for (const accountId of accountIds) {
    const account = vault.accounts.find((item) => item.id === accountId)!;
    try {
      const result = await queueEvmTrade({ ...req, type: 'TRENCH_EVM_TRADE', accountId });
      results.push({ ...result, accountId, name: account.name, address: account.address });
    } catch (error) {
      results.push({ ok: false, accountId, name: account.name, address: account.address, error: normalizeError(error) });
    }
  }
  return { ok: true, results };
}

async function handleEvmTrade(req: EvmTradeRequest): Promise<EvmTradeResponse> {
  const tradeStartedAt = performance.now();
  const tradeId = crypto.randomUUID().slice(0, 8);
  const logStage = (stage: string, details: Record<string, unknown> = {}) => {
    console.info(`[EVM trade ${tradeId}] ${new Date().toISOString()} +${Math.round(performance.now() - tradeStartedAt)}ms ${stage}`, details);
  };
  logStage('start', { side: req.side, token: req.tokenAddress, amount: req.amountUsdg });

  const { privateKey: pk } = await evmVaultQueue(() => getEvmAccountKey(req.accountId));

  const account = privateKeyToAccount(pk as `0x${string}`);
  const publicClient = publicEvmClient;
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http(RH_CHAIN_RPC) });

  const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  ] as const;

  const EXACT_INPUT_SINGLE_ABI = [{
    name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ]}],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }] as const;

  const EXACT_INPUT_ABI = [{
    name: 'exactInput', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'path', type: 'bytes' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
    ]}],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }] as const;

  const NATIVE_V4_INPUT_ABI = [{
    name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' }, { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ]}],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }] as const;

  const VIRTUALS_SWAP_ABI = [{
    name: 'swap', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'descs', type: 'tuple[]', components: [
        { name: 'routeType', type: 'uint8' }, { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' }, { name: 'pool', type: 'address' },
        { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' }, { name: 'hookData', type: 'bytes' },
        { name: 'extraAddress', type: 'address' }, { name: 'poolId', type: 'bytes32' },
      ]},
      { name: 'receiver', type: 'address' }, { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  }] as const;

  const FLAP_QUOTE_ABI = [{
    name: 'quoteExactInput', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'inputToken', type: 'address' }, { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
    ]}],
    outputs: [{ name: 'outputAmount', type: 'uint256' }],
  }] as const;

  const FLAP_SWAP_ABI = [{
    name: 'swapExactInput', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'inputToken', type: 'address' }, { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' }, { name: 'minOutputAmount', type: 'uint256' },
      { name: 'permitData', type: 'bytes' },
    ]}],
    outputs: [{ name: 'outputAmount', type: 'uint256' }],
  }] as const;

  const V4_QUOTER_ABI = [{
    name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'poolKey', type: 'tuple', components: [
        { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
      { name: 'zeroForOne', type: 'bool' }, { name: 'exactAmount', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ]}],
    outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
  }] as const;

  const ALLOWANCE_HOLDER_ABI = [{
    name: 'exec', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'operator', type: 'address' }, { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  }] as const;

  const SETTLER_EXECUTE_ABI = [{
    name: 'execute', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'slippage', type: 'tuple', components: [
        { name: 'recipient', type: 'address' }, { name: 'buyToken', type: 'address' },
        { name: 'minAmountOut', type: 'uint256' },
      ]},
      { name: 'actions', type: 'bytes[]' }, { name: 'zidAndAffiliate', type: 'bytes32' },
    ],
    outputs: [],
  }] as const;

  const SETTLER_ACTIONS_ABI = [
    {
      name: 'NATIVE_CHECK', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'deadline', type: 'uint256' }, { name: 'msgValue', type: 'uint256' }], outputs: [],
    },
    {
      name: 'UNISWAPV4', type: 'function', stateMutability: 'nonpayable',
      inputs: [
        { name: 'recipient', type: 'address' }, { name: 'sellToken', type: 'address' },
        { name: 'bps', type: 'uint256' }, { name: 'feeOnTransfer', type: 'bool' },
        { name: 'hashMul', type: 'uint256' }, { name: 'hashMod', type: 'uint256' },
        { name: 'fills', type: 'bytes' },
      ],
      outputs: [],
    },
  ] as const;

  // Normalize and validate tokenAddress — must be 42 chars (0x + 40 hex)
  const tokenAddr = req.tokenAddress?.trim().toLowerCase();
  if (!tokenAddr || !/^0x[0-9a-f]{40}$/.test(tokenAddr)) {
    throw new Error(`Invalid tokenAddress: "${req.tokenAddress}"`);
  }
  if (req.side !== 'buy' && req.side !== 'sell') throw new Error('Invalid trade side');
  if (!Number.isFinite(req.amountUsdg) || req.amountUsdg <= 0) throw new Error('Invalid order size');
  if (req.side === 'buy' && req.amountUsdg > MAX_EVM_BUY_ETH) throw new Error(`Buy exceeds ${MAX_EVM_BUY_ETH} ETH safety limit`);
  if (!Number.isFinite(req.slippageBps) || req.slippageBps < 0 || req.slippageBps > MAX_EVM_SLIPPAGE_BPS) {
    throw new Error(`Slippage must be between 0 and ${MAX_EVM_SLIPPAGE_BPS / 100}%`);
  }

  const useNativeEth = req.side === 'buy';
  const tokenIn  = req.side === 'buy' ? WETH_ADDRESS : tokenAddr;
  const tokenOut = req.side === 'buy' ? tokenAddr : USDG_ADDRESS;
  const suppliedPool = req.pairAddress?.trim().toLowerCase();
  const suppliedFee = req.poolFee;
  const routePromise = tokenAddr !== UFC_ADDRESS.toLowerCase()
    && tokenAddr !== DART_ADDRESS.toLowerCase()
    && !(suppliedPool && /^0x[0-9a-f]{40}$/.test(suppliedPool) && Number.isInteger(suppliedFee))
    ? resolveCachedSwapRoute(tokenIn, tokenOut)
    : null;
  const sellBalancePromise = req.side === 'sell'
    ? evmCall(tokenAddr, encodeBalanceOf(account.address))
    : null;

  // Native ETH buys use 18 decimals.
  // For sell: req.amountUsdg is a sell percentage (0-100), so we resolve
  //           the actual raw token amount from the on-chain balance.
  let amountIn: bigint;
  if (req.side === 'sell') {
    const balHex = await sellBalancePromise!;
    const balRaw = BigInt(balHex);
    // percentage is 0-100; use integer math to avoid fp precision loss
    const pctNumerator = BigInt(Math.round(Math.min(100, Math.max(0, req.amountUsdg)) * 100));
    amountIn = (balRaw * pctNumerator) / 10000n;
    if (amountIn === 0n) throw new Error('No token balance to sell (or 0% requested)');
  } else {
    amountIn = parseUnits(req.amountUsdg.toString(), 18);
  }

  const slippageBps = BigInt(Math.min(10_000, Math.max(0, Math.round(req.slippageBps))));
  const applySlippage = (quote: bigint) => (quote * (10_000n - slippageBps)) / 10_000n;
  const tokenAddress = tokenAddr as `0x${string}`;

  const balanceCheck = useNativeEth
    ? publicClient.getBalance({ address: account.address })
    : null;

  const verifyInputBalance = async () => {
    if (!balanceCheck) return;
    const nativeBalance = await balanceCheck;
    if (nativeBalance <= amountIn) throw new Error('Insufficient ETH balance');
  };

  const approveIfNeeded = async (spender: `0x${string}`) => {
    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, spender],
    });
    if (allowance === amountIn) return;
    const approval = await publicClient.simulateContract({
      account,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amountIn],
    });
    const approveTx = await walletClient.writeContract(approval.request);
    await recordEvmSubmission({
      hash: approveTx,
      accountId: req.accountId ?? '',
      address: account.address,
      side: req.side,
      tokenAddress,
      amount: req.amountUsdg,
      submittedAt: Date.now(),
      status: 'pending',
      kind: 'approval',
    });
    let approveReceipt;
    try {
      approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 60_000 });
    } catch (error) {
      throw new Error(`Token approval submitted as ${approveTx}; receipt pending: ${normalizeError(error)}`);
    }
    if (approveReceipt.status !== 'success') throw new Error('Token approval reverted');
    await updateEvmSubmissionStatus(approveTx, 'confirmed');
  };

  let hash: `0x${string}`;

  if (tokenAddr === UFC_ADDRESS.toLowerCase()) {
    await verifyInputBalance();
    const flapTokenIn = req.side === 'buy' ? ZERO_ADDRESS : tokenAddress;
    const flapTokenOut = req.side === 'buy' ? tokenAddress : ZERO_ADDRESS;
    const quoteSimulation = await publicClient.simulateContract({
      account,
      address: FLAP_PORTAL as `0x${string}`,
      abi: FLAP_QUOTE_ABI,
      functionName: 'quoteExactInput',
      args: [{ inputToken: flapTokenIn as `0x${string}`, outputToken: flapTokenOut as `0x${string}`, inputAmount: amountIn }],
    });
    const amountOutMinimum = applySlippage(quoteSimulation.result);
    if (req.side === 'sell') await approveIfNeeded(FLAP_PORTAL as `0x${string}`);
    const simulationStartedAt = performance.now();
    const request = await publicClient.simulateContract({
      account,
      address: FLAP_PORTAL as `0x${string}`,
      abi: FLAP_SWAP_ABI,
      functionName: 'swapExactInput',
      args: [{
        inputToken: flapTokenIn as `0x${string}`,
        outputToken: flapTokenOut as `0x${string}`,
        inputAmount: amountIn,
        minOutputAmount: amountOutMinimum,
        permitData: '0x',
      }],
      value: useNativeEth ? amountIn : undefined,
    });
    logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: 'flap' });
    hash = await walletClient.writeContract(request.request);
  } else if (tokenAddr === DART_ADDRESS.toLowerCase()) {
    await verifyInputBalance();
    const poolKey = {
      currency0: ZERO_ADDRESS as `0x${string}`,
      currency1: tokenAddress,
      fee: 0,
      tickSpacing: 200,
      hooks: DART_HOOK as `0x${string}`,
    };
    const quoteSimulation = await publicClient.simulateContract({
      account,
      address: V4_QUOTER as `0x${string}`,
      abi: V4_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey, zeroForOne: req.side === 'buy', exactAmount: amountIn, hookData: '0x' }],
    });
    let quotedOut = quoteSimulation.result[0];
    if (req.side === 'sell') quotedOut -= quotedOut / 100n;
    const amountOutMinimum = applySlippage(quotedOut);
    const simulationStartedAt = performance.now();
    if (req.side === 'buy') {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const actions = [
        encodeFunctionData({ abi: SETTLER_ACTIONS_ABI, functionName: 'NATIVE_CHECK', args: [deadline, amountIn] }),
        encodeSettlerUniswapV4Action(),
      ];
      const settlerData = encodeFunctionData({
        abi: SETTLER_EXECUTE_ABI,
        functionName: 'execute',
        args: [{ recipient: account.address, buyToken: tokenAddress, minAmountOut: amountOutMinimum }, actions, ZERO_BYTES32],
      });
      const request = await publicClient.simulateContract({
        account,
        address: ALLOWANCE_HOLDER as `0x${string}`,
        abi: ALLOWANCE_HOLDER_ABI,
        functionName: 'exec',
        args: [ROBINHOOD_SETTLER as `0x${string}`, ZERO_ADDRESS as `0x${string}`, amountIn, ROBINHOOD_SETTLER as `0x${string}`, settlerData],
        value: amountIn,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: 'dart-v4-settler' });
      hash = await walletClient.writeContract(request.request);
    } else {
      await approveIfNeeded(VIRTUALS_SWAP_ROUTER as `0x${string}`);
      const request = await publicClient.simulateContract({
        account,
        address: VIRTUALS_SWAP_ROUTER as `0x${string}`,
        abi: VIRTUALS_SWAP_ABI,
        functionName: 'swap',
        args: [[{
          routeType: 2,
          tokenIn: tokenAddress,
          tokenOut: ZERO_ADDRESS as `0x${string}`,
          pool: ZERO_ADDRESS as `0x${string}`,
          fee: 0,
          tickSpacing: 200,
          hooks: DART_HOOK as `0x${string}`,
          hookData: '0x',
          extraAddress: V4_POOL_MANAGER as `0x${string}`,
          poolId: ZERO_BYTES32,
        }], ZERO_ADDRESS as `0x${string}`, amountIn, amountOutMinimum, 0n],
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: 'dart-v4-router' });
      hash = await walletClient.writeContract(request.request);
    }
  } else {
    const routeStartedAt = performance.now();
    let route: SwapRoute;
    if (suppliedPool && /^0x[0-9a-f]{40}$/.test(suppliedPool) && Number.isInteger(suppliedFee)) {
      route = { type: 'direct', fee: suppliedFee as number };
    } else {
      route = await routePromise!;
    }
    await verifyInputBalance();
    logStage('route-resolved', {
      durationMs: Math.round(performance.now() - routeStartedAt),
      route: route.type,
      pool: route.type === 'virtuals' ? route.pool : suppliedPool,
    });
    const simulationStartedAt = performance.now();
    if (route.type === 'direct') {
      if (req.side === 'sell') await approveIfNeeded(UNISWAP_V3_ROUTER as `0x${string}`);
      const quoteRequest = await publicClient.simulateContract({
        account,
        address: UNISWAP_V3_ROUTER as `0x${string}`,
        abi: EXACT_INPUT_SINGLE_ABI,
        functionName: 'exactInputSingle',
        args: [{ tokenIn: tokenIn as `0x${string}`, tokenOut: tokenOut as `0x${string}`, fee: route.fee, recipient: account.address, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
        value: useNativeEth ? amountIn : undefined,
      });
      const request = await publicClient.simulateContract({
        account,
        address: UNISWAP_V3_ROUTER as `0x${string}`,
        abi: EXACT_INPUT_SINGLE_ABI,
        functionName: 'exactInputSingle',
        args: [{ tokenIn: tokenIn as `0x${string}`, tokenOut: tokenOut as `0x${string}`, fee: route.fee, recipient: account.address, amountIn, amountOutMinimum: applySlippage(quoteRequest.result), sqrtPriceLimitX96: 0n }],
        value: useNativeEth ? amountIn : undefined,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: route.type });
      hash = await walletClient.writeContract(request.request);
    } else if (route.type === 'multihop') {
      if (req.side === 'sell') await approveIfNeeded(UNISWAP_V3_ROUTER as `0x${string}`);
      const quoteRequest = await publicClient.simulateContract({
        account,
        address: UNISWAP_V3_ROUTER as `0x${string}`,
        abi: EXACT_INPUT_ABI,
        functionName: 'exactInput',
        args: [{ path: route.path, recipient: account.address, amountIn, amountOutMinimum: 0n }],
        value: useNativeEth ? amountIn : undefined,
      });
      const request = await publicClient.simulateContract({
        account,
        address: UNISWAP_V3_ROUTER as `0x${string}`,
        abi: EXACT_INPUT_ABI,
        functionName: 'exactInput',
        args: [{ path: route.path, recipient: account.address, amountIn, amountOutMinimum: applySlippage(quoteRequest.result), }],
        value: useNativeEth ? amountIn : undefined,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: route.type });
      hash = await walletClient.writeContract(request.request);
    } else if (route.type === 'virtuals') {
      const [tokenAResult, tokenBResult, tokenReservesResult, pairToken0Result, pairToken1Result, pairReservesResult] = await Promise.all([
        evmCall(route.pool, '0x0fc63d10'),
        evmCall(route.pool, '0x5f64b55b'),
        evmCall(route.pool, '0x0902f1ac'),
        evmCall(WETH_VIRTUAL_PAIR, '0x0dfe1681'),
        evmCall(WETH_VIRTUAL_PAIR, '0xd21220a7'),
        evmCall(WETH_VIRTUAL_PAIR, '0x0902f1ac'),
      ]);
      const tokenA = `0x${tokenAResult.slice(-40)}`.toLowerCase();
      const tokenB = `0x${tokenBResult.slice(-40)}`.toLowerCase();
      const [reserveA, reserveB] = decodeVirtualsReserves(tokenReservesResult);
      let virtualReserve: bigint;
      let tokenReserve: bigint;
      if (tokenA === tokenAddr && tokenB === VIRTUAL_ADDRESS.toLowerCase()) {
        [tokenReserve, virtualReserve] = [reserveA, reserveB];
      } else if (tokenB === tokenAddr && tokenA === VIRTUAL_ADDRESS.toLowerCase()) {
        [virtualReserve, tokenReserve] = [reserveA, reserveB];
      } else {
        throw new Error('Virtuals pool tokens do not match the requested trade');
      }
      const pairToken0 = `0x${pairToken0Result.slice(-40)}`.toLowerCase();
      const pairToken1 = `0x${pairToken1Result.slice(-40)}`.toLowerCase();
      const [pairReserve0, pairReserve1] = decodeVirtualsReserves(pairReservesResult);
      let wethReserve: bigint;
      let pairVirtualReserve: bigint;
      if (pairToken0 === WETH_ADDRESS.toLowerCase() && pairToken1 === VIRTUAL_ADDRESS.toLowerCase()) {
        [wethReserve, pairVirtualReserve] = [pairReserve0, pairReserve1];
      } else if (pairToken1 === WETH_ADDRESS.toLowerCase() && pairToken0 === VIRTUAL_ADDRESS.toLowerCase()) {
        [pairVirtualReserve, wethReserve] = [pairReserve0, pairReserve1];
      } else {
        throw new Error('Virtuals WETH pair tokens do not match the requested trade');
      }
      const quotedOut = req.side === 'buy'
        ? quoteVirtualsBuy(amountIn, wethReserve, pairVirtualReserve, virtualReserve, tokenReserve)
        : quoteVirtualsSell(amountIn, tokenReserve, virtualReserve, pairVirtualReserve, wethReserve);
      const amountOutMinimum = applySlippage(quotedOut);
      if (amountOutMinimum <= 0n) throw new Error('Virtuals quote returned zero output');
      if (req.side === 'sell') await approveIfNeeded(VIRTUALS_SWAP_ROUTER as `0x${string}`);
      const descs = req.side === 'buy'
        ? [
          {
            routeType: 0,
            tokenIn: WETH_ADDRESS as `0x${string}`,
            tokenOut: VIRTUAL_ADDRESS as `0x${string}`,
            pool: WETH_VIRTUAL_PAIR as `0x${string}`,
            fee: 3000,
            tickSpacing: 60,
            hooks: ZERO_ADDRESS as `0x${string}`,
            hookData: '0x' as `0x${string}`,
            extraAddress: ZERO_ADDRESS as `0x${string}`,
            poolId: ZERO_BYTES32,
          },
          {
            routeType: 4,
            tokenIn: VIRTUAL_ADDRESS as `0x${string}`,
            tokenOut: tokenAddress,
            pool: tokenAddress,
            fee: 0,
            tickSpacing: 0,
            hooks: ZERO_ADDRESS as `0x${string}`,
            hookData: '0x' as `0x${string}`,
            extraAddress: ZERO_ADDRESS as `0x${string}`,
            poolId: ZERO_BYTES32,
          },
        ]
        : [
          {
            routeType: 4,
            tokenIn: tokenAddress,
            tokenOut: VIRTUAL_ADDRESS as `0x${string}`,
            pool: tokenAddress,
            fee: 0,
            tickSpacing: 0,
            hooks: ZERO_ADDRESS as `0x${string}`,
            hookData: '0x' as `0x${string}`,
            extraAddress: ZERO_ADDRESS as `0x${string}`,
            poolId: ZERO_BYTES32,
          },
          {
            routeType: 0,
            tokenIn: VIRTUAL_ADDRESS as `0x${string}`,
            tokenOut: WETH_ADDRESS as `0x${string}`,
            pool: WETH_VIRTUAL_PAIR as `0x${string}`,
            fee: 3000,
            tickSpacing: 60,
            hooks: ZERO_ADDRESS as `0x${string}`,
            hookData: '0x' as `0x${string}`,
            extraAddress: ZERO_ADDRESS as `0x${string}`,
            poolId: ZERO_BYTES32,
          },
        ];
      const request = await publicClient.simulateContract({
        account,
        address: VIRTUALS_SWAP_ROUTER as `0x${string}`,
        abi: VIRTUALS_SWAP_ABI,
        functionName: 'swap',
        args: [descs, ZERO_ADDRESS as `0x${string}`, amountIn, amountOutMinimum, BigInt(Math.floor(Date.now() / 1000) + 300)],
        value: useNativeEth ? amountIn : undefined,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: route.type });
      hash = await walletClient.writeContract(request.request);
    } else if (route.type === 'native-v4') {
      if (req.side === 'sell') throw new Error('Native V4 sell is unavailable: the confirmed pool interface supports native ETH input only');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const quoteRequest = await publicClient.simulateContract({
        account,
        address: route.router as `0x${string}`,
        abi: NATIVE_V4_INPUT_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: ZERO_ADDRESS as `0x${string}`, tokenOut: tokenAddress, fee: route.fee,
          recipient: account.address, deadline, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
        }],
        value: amountIn,
      });
      const request = await publicClient.simulateContract({
        account,
        address: route.router as `0x${string}`,
        abi: NATIVE_V4_INPUT_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: ZERO_ADDRESS as `0x${string}`, tokenOut: tokenAddress, fee: route.fee,
          recipient: account.address, deadline, amountIn, amountOutMinimum: applySlippage(quoteRequest.result), sqrtPriceLimitX96: 0n,
        }],
        value: amountIn,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: route.type });
      hash = await walletClient.writeContract(request.request);
    } else if (route.type === 'doppler-v4') {
      if (req.side === 'sell') throw new Error('Doppler V4 sell is unavailable: the confirmed route currently supports native ETH buys only');
      const wethUsdg = await findBestDirectPool(WETH_ADDRESS, USDG_ADDRESS);
      if (!wethUsdg) throw new Error('No WETH/USDG bridge pool found for Doppler V4 buy');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const tickSpacingByFee: Record<number, number> = { 100: 1, 500: 10, 3000: 60, 10000: 200 };
      const wethUsdgQuote = await publicClient.simulateContract({
        account,
        address: UNISWAP_V3_ROUTER as `0x${string}`,
        abi: EXACT_INPUT_SINGLE_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: WETH_ADDRESS as `0x${string}`,
          tokenOut: USDG_ADDRESS as `0x${string}`,
          fee: wethUsdg.fee,
          recipient: account.address,
          amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        }],
        value: amountIn,
      });
      const inputPoolKey = {
        currency0: route.poolKey.currency0 as `0x${string}`,
        currency1: route.poolKey.currency1 as `0x${string}`,
        fee: route.poolKey.fee,
        tickSpacing: route.poolKey.tickSpacing,
        hooks: route.poolKey.hooks as `0x${string}`,
      };
      const quoteSimulation = await publicClient.simulateContract({
        account,
        address: V4_QUOTER as `0x${string}`,
        abi: V4_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          poolKey: inputPoolKey,
          zeroForOne: inputPoolKey.currency0.toLowerCase() === USDG_ADDRESS.toLowerCase(),
          exactAmount: wethUsdgQuote.result,
          hookData: '0x',
        }],
      });
      const descs = [
        {
          routeType: 0,
          tokenIn: WETH_ADDRESS as `0x${string}`,
          tokenOut: USDG_ADDRESS as `0x${string}`,
          pool: wethUsdg.pool as `0x${string}`,
          fee: wethUsdg.fee,
          tickSpacing: tickSpacingByFee[wethUsdg.fee] ?? 60,
          hooks: ZERO_ADDRESS as `0x${string}`,
          hookData: '0x' as `0x${string}`,
          extraAddress: ZERO_ADDRESS as `0x${string}`,
          poolId: ZERO_BYTES32,
        },
        {
          routeType: 2,
          tokenIn: USDG_ADDRESS as `0x${string}`,
          tokenOut: tokenAddress,
          pool: ZERO_ADDRESS as `0x${string}`,
          fee: inputPoolKey.fee,
          tickSpacing: inputPoolKey.tickSpacing,
          hooks: inputPoolKey.hooks,
          hookData: '0x' as `0x${string}`,
          extraAddress: V4_POOL_MANAGER as `0x${string}`,
          poolId: ZERO_BYTES32,
        },
      ];
      const request = await publicClient.simulateContract({
        account,
        address: VIRTUALS_SWAP_ROUTER as `0x${string}`,
        abi: VIRTUALS_SWAP_ABI,
        functionName: 'swap',
        args: [descs, account.address, amountIn, applySlippage(quoteSimulation.result[0]), deadline],
        value: amountIn,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: route.type });
      hash = await walletClient.writeContract(request.request);
    } else {
      if (req.side === 'sell') {
        throw new Error('Doppler sell is unavailable: the confirmed route currently reverts simulation');
      }
      const poolKey = {
        currency0: route.poolKey.currency0 as `0x${string}`,
        currency1: route.poolKey.currency1 as `0x${string}`,
        fee: route.poolKey.fee,
        tickSpacing: route.poolKey.tickSpacing,
        hooks: route.poolKey.hooks as `0x${string}`,
      };
      const quoteSimulation = await publicClient.simulateContract({
        account,
        address: V4_QUOTER as `0x${string}`,
        abi: V4_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          poolKey,
          zeroForOne: poolKey.currency0.toLowerCase() === tokenIn.toLowerCase(),
          exactAmount: amountIn,
          hookData: '0x',
        }],
      });
      const request = await publicClient.simulateContract({
        account,
        address: VIRTUALS_SWAP_ROUTER as `0x${string}`,
        abi: VIRTUALS_SWAP_ABI,
        functionName: 'swap',
        args: [[{
          routeType: 2,
          tokenIn: tokenIn as `0x${string}`,
          tokenOut: tokenOut as `0x${string}`,
          pool: ZERO_ADDRESS as `0x${string}`,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
          hookData: '0x',
          extraAddress: V4_POOL_MANAGER as `0x${string}`,
          poolId: ZERO_BYTES32,
        }], ZERO_ADDRESS as `0x${string}`, amountIn, applySlippage(quoteSimulation.result[0]), 0n],
        value: amountIn,
      });
      logStage('simulation-ok', { durationMs: Math.round(performance.now() - simulationStartedAt), route: route.type });
      hash = await walletClient.writeContract(request.request);
    }
  }

  logStage('transaction-sent', { hash });
  await recordEvmSubmission({
    hash,
    accountId: req.accountId ?? '',
    address: account.address,
    side: req.side,
    tokenAddress,
    amount: req.amountUsdg,
    submittedAt: Date.now(),
    status: 'pending',
    kind: 'trade',
  });

  void monitorEvmSubmission(publicClient, hash, logStage);
  return { ok: true, hash, status: 'pending' };
}

async function monitorEvmSubmission(
  client: typeof publicEvmClient,
  hash: `0x${string}`,
  logStage: (stage: string, details?: Record<string, unknown>) => void,
) {
  const receiptStartedAt = performance.now();
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') {
      await updateEvmSubmissionStatus(hash, 'failed');
      logStage('receipt-reverted', { hash });
      return;
    }
    await updateEvmSubmissionStatus(hash, 'confirmed');
    logStage('receipt-success', {
      durationMs: Math.round(performance.now() - receiptStartedAt),
      hash,
      blockNumber: receipt.blockNumber.toString(),
    });
  } catch (error) {
    logStage('receipt-pending', { hash, error: normalizeError(error) });
  }
}

type EvmSubmission = {
  hash: string;
  accountId: string;
  address: string;
  side: TradeSide;
  tokenAddress: string;
  amount: number;
  submittedAt: number;
  status: 'pending' | 'confirmed' | 'failed';
  kind?: 'approval' | 'trade';
};

async function recordEvmSubmission(submission: EvmSubmission) {
  const stored = await chrome.storage.local.get([EVM_SUBMISSION_JOURNAL_KEY]);
  const existing = Array.isArray(stored[EVM_SUBMISSION_JOURNAL_KEY])
    ? stored[EVM_SUBMISSION_JOURNAL_KEY] as EvmSubmission[]
    : [];
  await chrome.storage.local.set({ [EVM_SUBMISSION_JOURNAL_KEY]: [submission, ...existing.filter((item) => item.hash !== submission.hash)].slice(0, 200) });
}

async function updateEvmSubmissionStatus(hash: string, status: EvmSubmission['status']) {
  const stored = await chrome.storage.local.get([EVM_SUBMISSION_JOURNAL_KEY]);
  const existing = Array.isArray(stored[EVM_SUBMISSION_JOURNAL_KEY])
    ? stored[EVM_SUBMISSION_JOURNAL_KEY] as EvmSubmission[]
    : [];
  await chrome.storage.local.set({
    [EVM_SUBMISSION_JOURNAL_KEY]: existing.map((item) => item.hash === hash ? { ...item, status } : item),
  });
}

function encodeSettlerUniswapV4Action(): `0x${string}` {
  const abi = [{
    name: 'UNISWAPV4_PAYLOAD', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' }, { name: 'sellToken', type: 'address' },
      { name: 'bps', type: 'uint256' }, { name: 'feeOnTransfer', type: 'bool' },
      { name: 'hashMul', type: 'uint256' }, { name: 'hashMod', type: 'uint256' },
      { name: 'fills', type: 'bytes' }, { name: 'reserved', type: 'uint256' },
    ],
    outputs: [],
  }] as const;
  const payload = encodeFunctionData({
    abi,
    functionName: 'UNISWAPV4_PAYLOAD',
    args: [
      ROBINHOOD_SETTLER as `0x${string}`,
      NATIVE_TOKEN_SENTINEL as `0x${string}`,
      10_000n,
      false,
      2n,
      18_446_744_073_709_551_557n,
      DART_V4_FILLS as `0x${string}`,
      0n,
    ],
  });
  return `0xaf72634f${payload.slice(10)}` as `0x${string}`;
}
