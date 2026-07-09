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

interface TokenRow {
  address: string;
  symbol: string;
  name: string;
  pool: string;
  fee: number;
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

async function doBuy(tokenAddress: string, amountUsdg: number, slippageBps: number): Promise<{ ok: boolean; hash?: string; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'TRENCH_EVM_TRADE',
      side: 'buy',
      tokenAddress,
      amountUsdg,
      slippageBps,
      inputCurrency: 'USDG',
    }, (r) => {
      const resp = r as { ok?: boolean; hash?: string; error?: string } | undefined;
      if (!resp) { resolve({ ok: false, error: 'No response' }); return; }
      resolve({ ok: !!resp.ok, hash: resp.hash, error: resp.error });
    });
  });
}

function TokenRow({ token, buyAmount, slippageBps, onBuy }: {
  token: TokenRow;
  buyAmount: number;
  slippageBps: number;
  onBuy: (addr: string) => void;
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
            onClick={() => onBuy(token.address)}
            title={`Buy ${buyAmount} USDG`}
          >{token.buying ? '…' : '⚡ BUY'}</button>
        </div>
      </div>
      {token.buyError && <div className="tr-row-err">{token.buyError}</div>}
      {token.buyHash && (
        <div className="tr-row-ok">
          <a href={`https://robinhoodchain.blockscout.com/tx/${token.buyHash}`} target="_blank" rel="noreferrer">✓ {token.buyHash.slice(0, 10)}…</a>
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
  onBuy: (addr: string) => void;
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
  const [buyAmount, setBuyAmount] = useState(10);
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
      const token0 = '0x' + log.topics[1].slice(26).toLowerCase();
      const token1 = '0x' + log.topics[2].slice(26).toLowerCase();
      const fee = parseInt(log.topics[3], 16);
      // pool address is in data bytes 12..32 (first 32 bytes, last 20 = address)
      const pool = ('0x' + log.data.slice(2 + 24, 2 + 64)).toLowerCase();
      const blockNum = parseInt(log.blockNumber, 16);

      if (!pool || pool === '0x' + '0'.repeat(40)) continue;
      // deduplicate by pool address only — same token can have multiple pools
      if (seenPools.current.has(pool)) continue;
      seenPools.current.add(pool);

      const weth = WETH.toLowerCase();
      const usdg = USDG.toLowerCase();

      // pick the non-WETH/USDG side as the token
      let tokenAddr: string;
      if (token0 === weth || token0 === usdg) tokenAddr = token1;
      else if (token1 === weth || token1 === usdg) tokenAddr = token0;
      else tokenAddr = token0; // unknown pair — show token0

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

  const handleBuy = useCallback(async (addr: string) => {
    setTokenMap(prev => {
      const next = new Map(prev);
      const t = next.get(addr.toLowerCase());
      if (t) next.set(addr.toLowerCase(), { ...t, buying: true, buyError: undefined, buyHash: undefined });
      return next;
    });
    const slippageBps = Math.round(slippage * 100);
    const result = await doBuy(addr, buyAmount, slippageBps);
    setTokenMap(prev => {
      const next = new Map(prev);
      const t = next.get(addr.toLowerCase());
      if (t) next.set(addr.toLowerCase(), {
        ...t,
        buying: false,
        buyError: result.ok ? undefined : (result.error ?? 'Failed'),
        buyHash: result.ok ? result.hash : undefined,
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
            <input className="tr-ctrl-input" type="number" min={1} value={buyAmount}
              onChange={e => setBuyAmount(Math.max(1, Number(e.target.value)))} />
            USDG
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
