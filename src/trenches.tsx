import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './trenches-styles.css';

const RH_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const POOL_CREATED_TOPIC = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118';
const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
const MAX_PER_LANE = 50;

type RuntimeResponse = { ok?: boolean; hash?: string; error?: string; summary?: string; results?: Array<{ ok: boolean; hash?: string; error?: string }> };

function sendRuntimeMessage(message: unknown): Promise<RuntimeResponse> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve((response ?? {}) as RuntimeResponse);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Extension context unavailable'));
    }
  });
}

function isInvalidExtensionContext(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(message);
}

async function ensureRuntimeReady() {
  try {
    const response = await sendRuntimeMessage({ type: 'TRENCH_RUNTIME_PING' });
    if (!response.ok) throw new Error('Extension background unavailable');
  } catch (error) {
    if (isInvalidExtensionContext(error)) {
      window.location.reload();
      return false;
    }
    throw error;
  }
  return true;
}

interface TokenRow {
  address: string;
  symbol: string;
  name: string;
  pool: string;
  fee: number;
  quoteCurrency: 'WETH' | 'USDG';
  blockNumber: number;
  blockTs: number;
  mcUsdg: number;
  volUsdg: number;
  txCount: number;
  usdgReserve: number;
  lane: 'new' | 'bonding' | 'migrated';
  buying?: boolean;
  buyError?: string;
  buyHash?: string;
  buySummary?: string;
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(RH_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const d = await r.json() as { result?: unknown; error?: { message: string } };
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

async function ethCall(to: string, data: string): Promise<string> {
  return rpcCall('eth_call', [{ to, data }, 'latest']) as Promise<string>;
}

function decodeString(hex: string): string {
  if (!hex || hex === '0x') return '';
  try {
    const raw = hex.slice(2);
    // ABI-encoded string: first 32 bytes = offset, next 32 = length, then data
    const offset = parseInt(raw.slice(0, 64), 16) * 2;
    const len = parseInt(raw.slice(offset, offset + 64), 16) * 2;
    const strHex = raw.slice(offset + 64, offset + 64 + len);
    const bytes = new Uint8Array(strHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\0/g, '').trim();
  } catch { return ''; }
}

async function fetchTokenMeta(addr: string): Promise<{ symbol: string; name: string }> {
  try {
    const [symHex, nameHex] = await Promise.all([
      ethCall(addr, '0x95d89b41'),
      ethCall(addr, '0x06fdde03'),
    ]);
    return { symbol: decodeString(symHex).slice(0, 12), name: decodeString(nameHex).slice(0, 32) };
  } catch { return { symbol: '???', name: '' }; }
}

async function fetchPoolStats(pool: string, blockFrom: number): Promise<{ mcUsdg: number; volUsdg: number; txCount: number; usdgReserve: number }> {
  try {
    const fromHex = '0x' + blockFrom.toString(16);
    const usdgBalHex = await ethCall(USDG, '0x70a08231' + pool.slice(2).padStart(64, '0'));
    const usdgReserve = Number(BigInt(usdgBalHex || '0x0')) / 1e6;

    const logs = await rpcCall('eth_getLogs', [{
      address: pool,
      topics: [SWAP_TOPIC],
      fromBlock: fromHex,
      toBlock: 'latest',
    }]) as Array<{ data: string }>;

    let volUsdg = 0;
    for (const log of logs) {
      const d = log.data.slice(2);
      const a0raw = BigInt('0x' + d.slice(0, 64));
      const a0 = a0raw >= (BigInt(1) << BigInt(255))
        ? -(BigInt(1) << BigInt(256)) + a0raw
        : a0raw;
      volUsdg += Math.abs(Number(a0)) / 1e6;
    }

    return { mcUsdg: usdgReserve * 2, volUsdg, txCount: logs.length, usdgReserve };
  } catch {
    return { mcUsdg: 0, volUsdg: 0, txCount: 0, usdgReserve: 0 };
  }
}

// Safely extract a 20-byte EVM address from a 32-byte topic or data word
function extractAddr(hex: string): string {
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
  const addr = raw.slice(-40).toLowerCase(); // last 40 hex chars = 20 bytes
  if (addr.length !== 40) return '';
  return '0x' + addr;
}

async function getLatestBlock(): Promise<number> {
  const hex = await rpcCall('eth_blockNumber', []) as string;
  return parseInt(hex, 16);
}

async function getBlockTimestamp(blockHex: string): Promise<number> {
  try {
    const b = await rpcCall('eth_getBlockByNumber', [blockHex, false]) as { timestamp: string } | null;
    return b ? parseInt(b.timestamp, 16) : Math.floor(Date.now() / 1000);
  } catch { return Math.floor(Date.now() / 1000); }
}

function formatAge(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmt$(n: number): string {
  if (!n) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function doBuy(token: TokenRow, amountEth: number, slippageBps: number): Promise<{ ok: boolean; hash?: string; error?: string; summary?: string }> {
  const tokenAddress = token.address;
  try {
    if (!await ensureRuntimeReady()) return { ok: false, error: 'Reloading extension context' };
    const accounts = await sendRuntimeMessage({ type: 'TRENCH_EVM_ACCOUNTS_LIST' }) as { activeAccountId?: string; selectedAccountIds?: string[] };
    const accountIds = accounts.selectedAccountIds?.length ? accounts.selectedAccountIds : (accounts.activeAccountId ? [accounts.activeAccountId] : []);
    if (!accountIds.length) return { ok: false, error: 'Select a wallet in Options' };
    const response = await sendRuntimeMessage({
      type: 'TRENCH_EVM_BATCH_TRADE',
      accountIds,
      side: 'buy',
      tokenAddress,
      pairAddress: token.quoteCurrency === 'WETH' ? token.pool : undefined,
      poolFee: token.quoteCurrency === 'WETH' ? token.fee : undefined,
      amountUsdg: amountEth,
      slippageBps,
    });
    const results = response.results;
    const filled = results?.filter((result) => result.ok) ?? [];
    const total = results?.length ?? accountIds.length;
    const failed = total - filled.length;
    return {
      ok: filled.length > 0,
      hash: filled[0]?.hash,
      summary: `${filled.length}/${total} wallets`,
      error: failed ? `${failed} wallet${failed === 1 ? '' : 's'} failed` : undefined,
    };
  } catch (error) {
    if (isInvalidExtensionContext(error)) {
      return { ok: false, error: 'Extension reloaded during trade. Check wallet activity before retrying.' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Buy failed' };
  }
}

function TokenRow({ token, buyAmount, slippageBps, onBuy }: {
  token: TokenRow;
  buyAmount: number;
  slippageBps: number;
  onBuy: (token: TokenRow) => void;
}) {
  const age = formatAge(token.blockTs);
  const feeLabel = (token.fee / 10000).toFixed(2) + '%';

  return (
    <div className="tr-row">
      <div className="tr-row-avatar">
        <div className="tr-avatar-placeholder">{(token.symbol || '?')[0]}</div>
      </div>
      <div className="tr-row-body">
        <div className="tr-row-top">
          <span className="tr-row-symbol">{token.symbol}</span>
          <span className="tr-row-name">{token.name}</span>
          <span className="tr-row-age">{age}</span>
        </div>
        <div className="tr-row-addr">{shortAddr(token.address)}</div>
        <div className="tr-row-metrics">
          <span className="tr-m"><span className="tr-ml">MC</span>{fmt$(token.mcUsdg)}</span>
          <span className="tr-m"><span className="tr-ml">V</span>{fmt$(token.volUsdg)}</span>
          <span className="tr-m"><span className="tr-ml">TX</span>{token.txCount || '0'}</span>
          <span className="tr-m tr-fee">{feeLabel}</span>
        </div>
      </div>
      <div className="tr-row-actions">
        <div className="tr-btn-pair">
          <button
            className="tr-row-gmgn"
            onClick={() => window.open(`https://gmgn.ai/robinhood/token/${token.address}`, '_blank')}
          >GMGN</button>
          <button
            className={`tr-row-buy ${token.buying ? 'tr-buying' : ''}`}
            disabled={token.buying}
            onClick={(event) => {
              if (event.nativeEvent.isTrusted) onBuy(token);
            }}
            title={`Buy ${buyAmount} WETH`}
          >{token.buying ? '…' : '⚡ BUY'}</button>
        </div>
      </div>
      {token.buyError && <div className="tr-row-err">{token.buyError}</div>}
      {token.buyHash && (
        <div className="tr-row-ok">
          <a href={`https://robinhoodchain.blockscout.com/tx/${token.buyHash}`} target="_blank" rel="noreferrer">{token.buySummary ?? 'Filled'} · {token.buyHash.slice(0, 10)}…</a>
        </div>
      )}
    </div>
  );
}

function Lane({ title, tokens, buyAmount, slippageBps, onBuy, status }: {
  title: string;
  tokens: TokenRow[];
  buyAmount: number;
  slippageBps: number;
  onBuy: (token: TokenRow) => void;
  status?: string;
}) {
  return (
    <div className="tr-lane">
      <div className="tr-lane-header">
        <span className="tr-lane-title">{title}</span>
        <span className="tr-lane-count">{tokens.length}</span>
        {status && <span className="tr-lane-status">{status}</span>}
      </div>
      <div className="tr-lane-feed">
        {tokens.length === 0 ? (
          <div className="tr-lane-empty">Waiting…</div>
        ) : tokens.map(t => (
          <TokenRow
            key={t.address}
            token={t}
            buyAmount={buyAmount}
            slippageBps={slippageBps}
            onBuy={onBuy}
          />
        ))}
      </div>
    </div>
  );
}

export default function TrenchesApp() {
  const [tokenMap, setTokenMap] = useState<Map<string, TokenRow>>(new Map());
  const [buyAmount, setBuyAmount] = useState(0.01);
  const [slippage, setSlippage] = useState(0.5);
  const [blockStatus, setBlockStatus] = useState('Connecting…');
  const lastBlockRef = useRef(0);
  const seenPools = useRef(new Set<string>());
  const processingRef = useRef(false);

  const upsertToken = useCallback((token: TokenRow) => {
    setTokenMap(prev => {
      const next = new Map(prev);
      const key = token.address.toLowerCase();
      const existing = next.get(key);
      if (existing) {
        next.set(key, { ...existing, ...token });
      } else {
        next.set(key, token);
      }
      return next;
    });
  }, []);

  const processLogs = useCallback(async (logs: Array<{ topics: string[]; data: string; blockNumber: string }>) => {
    for (const log of logs) {
      const token0 = extractAddr(log.topics[1]);
      const token1 = extractAddr(log.topics[2]);
      const fee = parseInt(log.topics[3], 16);
      // PoolCreated data: tickSpacing(32 bytes) + pool(32 bytes) — pool = last 40 hex chars
      const pool = extractAddr(log.data);
      const blockNum = parseInt(log.blockNumber, 16);

      if (!pool || pool === '0x' + '0'.repeat(40)) continue;
      const liquidityHex = await ethCall(pool, '0x1a686502').catch(() => '0x0');
      if (BigInt(liquidityHex || '0x0') === 0n) continue;
      // deduplicate by pool address only — same token can have multiple pools
      if (seenPools.current.has(pool)) continue;
      seenPools.current.add(pool);

      const weth = WETH.toLowerCase();
      const usdg = USDG.toLowerCase();

      // Pick the non-quote side as the token and retain the pool's actual quote currency.
      let tokenAddr: string;
      let quoteCurrency: TokenRow['quoteCurrency'];
      if (token0 === weth || token0 === usdg) {
        tokenAddr = token1;
        quoteCurrency = token0 === weth ? 'WETH' : 'USDG';
      } else if (token1 === weth || token1 === usdg) {
        tokenAddr = token0;
        quoteCurrency = token1 === weth ? 'WETH' : 'USDG';
      } else {
        continue;
      }

      if (!tokenAddr || tokenAddr === '0x' + '0'.repeat(40)) continue;

      const blockTs = await getBlockTimestamp(log.blockNumber);
      const meta = await fetchTokenMeta(tokenAddr);
      // show token even if symbol is empty/unknown — never silently drop
      const symbol = meta.symbol || tokenAddr.slice(2, 8).toUpperCase();
      const name = meta.name || '';

      const row: TokenRow = {
        address: tokenAddr,
        symbol,
        name,
        pool,
        fee,
        quoteCurrency,
        blockNumber: blockNum,
        blockTs,
        mcUsdg: 0,
        volUsdg: 0,
        txCount: 0,
        usdgReserve: 0,
        lane: 'new',
      };
      upsertToken(row);

      fetchPoolStats(pool, blockNum).then(stats => {
        const lane: TokenRow['lane'] = stats.usdgReserve > 50000 ? 'migrated'
          : stats.usdgReserve > 10000 ? 'bonding'
          : 'new';
        upsertToken({ ...row, ...stats, lane });
      }).catch(() => {});
    }
  }, [upsertToken]);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const latest = await getLatestBlock();
        if (lastBlockRef.current === 0) {
          lastBlockRef.current = latest;
        }
        if (latest <= lastBlockRef.current) return;

        const fromHex = '0x' + lastBlockRef.current.toString(16);
        lastBlockRef.current = latest;
        setBlockStatus(`Block ${latest}`);

        const logs = await rpcCall('eth_getLogs', [{
          address: FACTORY,
          topics: [POOL_CREATED_TOPIC],
          fromBlock: fromHex,
          toBlock: 'latest',
        }]) as Array<{ topics: string[]; data: string; blockNumber: string }>;

        if (logs.length > 0) await processLogs(logs);
      } catch (e) {
        setBlockStatus(`Error: ${(e as Error).message.slice(0, 40)}`);
      } finally {
        processingRef.current = false;
      }
    }

    void poll();
    const id = setInterval(() => { if (!stopped) void poll(); }, 2500);
    return () => { stopped = true; clearInterval(id); };
  }, [processLogs]);

  useEffect(() => {
    void ensureRuntimeReady().catch((error) => {
      setBlockStatus(`Extension error: ${(error as Error).message.slice(0, 32)}`);
    });
  }, []);

  const handleBuy = useCallback(async (token: TokenRow) => {
    const addr = token.address;
    setTokenMap(prev => {
      const next = new Map(prev);
      const t = next.get(addr.toLowerCase());
      if (t) next.set(addr.toLowerCase(), { ...t, buying: true, buyError: undefined, buyHash: undefined, buySummary: undefined });
      return next;
    });
    const slippageBps = Math.round(slippage * 100);
    const result: RuntimeResponse = await doBuy(token, buyAmount, slippageBps).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : 'Buy failed',
    }));
    setTokenMap(prev => {
      const next = new Map(prev);
      const t = next.get(addr.toLowerCase());
      if (t) next.set(addr.toLowerCase(), {
        ...t,
        buying: false,
        buyError: result.error,
        buyHash: result.ok ? result.hash : undefined,
        buySummary: result.summary,
      });
      return next;
    });
  }, [buyAmount, slippage]);

  const allTokens = Array.from(tokenMap.values());
  const newTokens = allTokens.filter(t => t.lane === 'new').sort((a, b) => b.blockTs - a.blockTs).slice(0, MAX_PER_LANE);
  const bondingTokens = allTokens.filter(t => t.lane === 'bonding').sort((a, b) => b.usdgReserve - a.usdgReserve).slice(0, MAX_PER_LANE);
  const migratedTokens = allTokens.filter(t => t.lane === 'migrated').sort((a, b) => b.blockTs - a.blockTs).slice(0, MAX_PER_LANE);
  const slippageBps = Math.round(slippage * 100);

  return (
    <div className="tr-root">
      <div className="tr-header">
        <span className="tr-logo">TRENCHES</span>
        <span className="tr-chain-badge">RH CHAIN</span>
        <div className="tr-header-controls">
          <label className="tr-ctrl">
            Buy
            <input className="tr-ctrl-input" type="number" min={0.0001} step={0.001} value={buyAmount}
              onChange={e => setBuyAmount(Math.max(0.0001, Number(e.target.value)))} />
            ETH
          </label>
          <label className="tr-ctrl">
            Slippage
            <input className="tr-ctrl-input" type="number" min={0.1} step={0.5} value={slippage}
              onChange={e => setSlippage(Number(e.target.value))} />
            %
          </label>
        </div>
        <span className="tr-block-status">{blockStatus}</span>
      </div>

      <div className="tr-lanes">
        <Lane title="NEW" tokens={newTokens} buyAmount={buyAmount} slippageBps={slippageBps} onBuy={handleBuy} />
        <Lane title="ALMOST BONDED" tokens={bondingTokens} buyAmount={buyAmount} slippageBps={slippageBps} onBuy={handleBuy} />
        <Lane title="MIGRATED" tokens={migratedTokens} buyAmount={buyAmount} slippageBps={slippageBps} onBuy={handleBuy} />
      </div>
    </div>
  );
}

const root = document.getElementById('root')!;
createRoot(root).render(<TrenchesApp />);
