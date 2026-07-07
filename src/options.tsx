import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ExternalLink, Gauge, History, KeyRound, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { defaultSettings, getActiveRpcUrl, HELIUS_RPC_TEMPLATE, JITO_MAINNET_TRANSACTION_URL, loadExtensionSettings, PUBLIC_TEST_RPC_URL, resetExtensionSettings, saveExtensionSettings, SHYFT_RPC_TEMPLATE, TRENCH_RPC_URL } from './storage';
import type { HotWalletResponse, IndexHistoryResponse, TradeSettings } from './types';
import './options.css';

type Tab = 'rpc' | 'fees' | 'wallet' | 'controls' | 'history';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'rpc',      label: 'RPC',      icon: <Zap size={14} /> },
  { id: 'fees',     label: 'Fees',     icon: <SlidersHorizontal size={14} /> },
  { id: 'wallet',   label: 'Wallet',   icon: <KeyRound size={14} /> },
  { id: 'controls', label: 'Controls', icon: <ShieldCheck size={14} /> },
  { id: 'history',  label: 'History',  icon: <History size={14} /> },
];

function OptionsApp() {
  const [tab, setTab] = useState<Tab>('rpc');
  const [settings, setSettings] = useState<TradeSettings>(defaultSettings);
  const [saved, setSaved] = useState(true);
  const [rpcStatus, setRpcStatus] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });
  const [secretKey, setSecretKey] = useState('');
  const [password, setPassword] = useState('');
  const [hotWallet, setHotWallet] = useState<HotWalletResponse>({ ok: true, hasWallet: false, unlocked: false });
  const [indexMint, setIndexMint] = useState('');
  const [indexWallet, setIndexWallet] = useState('');
  const [indexStatus, setIndexStatus] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });

  useEffect(() => {
    void loadExtensionSettings().then(setSettings);
    void hotWalletRequest({ type: 'TRENCH_HOT_WALLET_STATUS' }).then(setHotWallet);
  }, []);

  function patch(p: Partial<TradeSettings>) {
    setSettings(s => ({ ...s, ...p }));
    setSaved(false);
  }

  async function save() {
    await saveExtensionSettings(settings);
    setSaved(true);
  }

  async function reset() {
    const d = await resetExtensionSettings();
    setSettings(d);
    setSaved(true);
  }

  async function testRpc() {
    setRpcStatus({ state: 'testing', text: 'Testing…' });
    try {
      const r = await measureRpc(getActiveRpcUrl(settings));
      setRpcStatus({ state: 'ok', text: `${r.health} · slot ${r.slot.toLocaleString()} · ${r.ms} ms` });
    } catch (e) {
      setRpcStatus({ state: 'error', text: e instanceof Error ? e.message : 'failed' });
    }
  }

  async function importHotWallet() {
    const r = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_IMPORT', secretKey, password });
    setHotWallet(r);
    setSecretKey('');
    setPassword('');
    if (r.publicKey) await applyAndSave({ signerMode: 'local', localWalletPublicKey: r.publicKey });
  }

  async function unlockHotWallet() {
    const r = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_UNLOCK', password });
    setHotWallet(r);
    setPassword('');
    if (r.publicKey) await applyAndSave({ signerMode: 'local', localWalletPublicKey: r.publicKey });
  }

  async function lockHotWallet() {
    setHotWallet(await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_LOCK' }));
  }

  async function forgetHotWallet() {
    setHotWallet(await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_FORGET' }));
    await applyAndSave({ signerMode: 'wallet', localWalletPublicKey: '' });
  }

  async function applyAndSave(p: Partial<TradeSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    await saveExtensionSettings(next);
    setSaved(true);
  }

  async function indexHistory() {
    const wallet = indexWallet.trim() || settings.localWalletPublicKey;
    const mint = indexMint.trim();
    if (!wallet) { setIndexStatus({ state: 'error', text: 'No wallet address.' }); return; }
    if (!mint)   { setIndexStatus({ state: 'error', text: 'Enter token mint.' }); return; }
    setIndexStatus({ state: 'running', text: 'Scanning…' });
    try {
      const r = await new Promise<IndexHistoryResponse>(res =>
        chrome.runtime.sendMessage({ type: 'TRENCH_INDEX_HISTORY', wallet, mint, settings }, (x: unknown) => res(x as IndexHistoryResponse))
      );
      setIndexStatus(r.ok
        ? { state: 'ok',    text: `${r.scanned} txs scanned · ${r.matched} matched · cost basis ${r.costBasisSol.toFixed(4)} SOL · PnL ${r.realizedPnlSol.toFixed(4)} SOL` }
        : { state: 'error', text: r.error ?? 'failed' });
    } catch (e) {
      setIndexStatus({ state: 'error', text: e instanceof Error ? e.message : 'failed' });
    }
  }

  const walletLine = hotWallet.unlocked
    ? `Unlocked · ${shortKey(hotWallet.publicKey)}`
    : hotWallet.hasWallet
    ? `Locked · ${shortKey(hotWallet.publicKey)}`
    : 'Not imported';

  return (
    <main className="opt-shell">
      {/* Header */}
      <header className="opt-header">
        <div className="opt-logo">TR</div>
        <div className="opt-title-block">
          <span className="opt-eyebrow">Trench for Axiom</span>
          <span className="opt-title">Settings</span>
        </div>
        <div className="opt-header-right">
          {!saved && <span className="opt-unsaved">Unsaved</span>}
          <button className="opt-btn-ghost" onClick={reset}><RotateCcw size={13} /> Reset</button>
          <button className="opt-btn-primary" onClick={save}><Save size={13} /> Save</button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="opt-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`opt-tab${tab === t.id ? ' opt-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </nav>

      {/* Panels */}
      <div className="opt-body">
        {tab === 'rpc' && (
          <div className="opt-panel-grid">
            <section className="opt-card">
              <h3 className="opt-card-title">Engine &amp; Signer</h3>
              <Row label="Engine">
                <select value={settings.executionMode} onChange={e => patch({ executionMode: e.target.value as TradeSettings['executionMode'] })}>
                  <option value="auto">Auto (detect Pump vs Jupiter)</option>
                  <option value="jupiter">Jupiter</option>
                  <option value="pump">Pump</option>
                </select>
              </Row>
              <Row label="Signer">
                <select value={settings.signerMode} onChange={e => patch({ signerMode: e.target.value as TradeSettings['signerMode'] })}>
                  <option value="wallet">Browser wallet (Phantom / Solflare)</option>
                  <option value="local">Local hot wallet (no popup)</option>
                </select>
              </Row>
              <div className="opt-status-row">
                <span className="opt-label">Hot wallet</span>
                <span className={`opt-badge ${hotWallet.unlocked ? 'opt-badge-green' : hotWallet.hasWallet ? 'opt-badge-dim' : 'opt-badge-off'}`}>
                  {walletLine}
                </span>
              </div>
            </section>

            <section className="opt-card">
              <h3 className="opt-card-title">RPC Endpoint</h3>
              <Row label="URL">
                <input value={settings.rpcUrl} onChange={e => patch({ rpcUrl: e.target.value })} spellCheck={false} />
              </Row>
              <Row label="Mode">
                <select value={settings.rpcMode} onChange={e => patch({ rpcMode: e.target.value as TradeSettings['rpcMode'] })}>
                  <option value="custom">Custom RPC — 0% Trench fee</option>
                  <option value="trench">Trench RPC — 0.1% routing fee</option>
                </select>
              </Row>
              <div className="opt-quick-btns">
                <button className="opt-btn-ghost-sm" onClick={() => patch({ rpcUrl: PUBLIC_TEST_RPC_URL })}>Public</button>
                <button className="opt-btn-ghost-sm" onClick={() => patch({ rpcUrl: HELIUS_RPC_TEMPLATE })}>Helius</button>
                <button className="opt-btn-ghost-sm" onClick={() => patch({ rpcUrl: SHYFT_RPC_TEMPLATE })}>Shyft</button>
                <button className="opt-btn-ghost-sm" onClick={() => patch({ rpcMode: 'trench', trenchRpcUrl: TRENCH_RPC_URL })}>Trench</button>
                <button className="opt-btn-ghost-sm" onClick={testRpc}><Gauge size={12} /> Test</button>
              </div>
              {rpcStatus.text && <div className={`opt-result opt-result-${rpcStatus.state}`}>{rpcStatus.text}</div>}
            </section>

            <section className="opt-card">
              <h3 className="opt-card-title">Send Mode</h3>
              <Row label="Mode">
                <select value={settings.sendMode} onChange={e => patch({ sendMode: e.target.value as TradeSettings['sendMode'] })}>
                  <option value="rpc">RPC (standard preflight)</option>
                  <option value="jito">Jito (low-latency bundle)</option>
                </select>
              </Row>
              <Row label="Jito endpoint">
                <input value={settings.jitoEndpoint} onChange={e => patch({ jitoEndpoint: e.target.value })} spellCheck={false} />
              </Row>
              <div className="opt-quick-btns">
                <button className="opt-btn-ghost-sm" onClick={() => patch({ jitoEndpoint: JITO_MAINNET_TRANSACTION_URL })}>Mainnet default</button>
              </div>
              <div className="opt-toggle-row">
                <span className="opt-label">Bundle only (no fallback)</span>
                <input type="checkbox" checked={settings.jitoBundleOnly} onChange={e => patch({ jitoBundleOnly: e.target.checked })} />
              </div>
            </section>

            <section className="opt-card opt-card-info">
              <h3 className="opt-card-title">Free RPC providers</h3>
              <div className="opt-links">
                <ProviderLink href="https://dashboard.helius.dev/" label="Helius" note="Free developer tier" />
                <ProviderLink href="https://shyft.to/get-api-key" label="Shyft" note="API key required" />
                <ProviderLink href="https://www.quicknode.com/" label="QuickNode" note="Free endpoint tier" />
              </div>
              <p className="opt-info-text">Custom RPC = 0% Trench fee. Trench RPC = 0.1% routing fee disclosed at send time.</p>
            </section>
          </div>
        )}

        {tab === 'fees' && (
          <div className="opt-panel-grid">
            <section className="opt-card">
              <h3 className="opt-card-title">Quick-buy amounts (SOL)</h3>
              <p className="opt-hint">Four values, space-separated. Maps to buttons 1–4 and hotkeys 1–4.</p>
              <input
                className="opt-input-full"
                value={settings.buyAmounts.join(' ')}
                onChange={e => patch({ buyAmounts: parseNumberList(e.target.value, defaultSettings.buyAmounts, 4) })}
              />
              <div className="opt-pill-preview">
                {settings.buyAmounts.map((v, i) => <span key={i} className="opt-pill">{v}</span>)}
              </div>
            </section>

            <section className="opt-card">
              <h3 className="opt-card-title">Quick-sell percentages</h3>
              <p className="opt-hint">Four values 1–100, space-separated. Maps to Q–R hotkeys.</p>
              <input
                className="opt-input-full"
                value={settings.sellPercents.join(' ')}
                onChange={e => patch({ sellPercents: parseNumberList(e.target.value, defaultSettings.sellPercents, 4).map(v => Math.min(100, v)) })}
              />
              <div className="opt-pill-preview">
                {settings.sellPercents.map((v, i) => <span key={i} className="opt-pill">{v}%</span>)}
              </div>
            </section>

            <section className="opt-card">
              <h3 className="opt-card-title">Slippage &amp; Priority</h3>
              <Row label="Slippage %">
                <input type="number" min="0" max="50" value={settings.slippage} onChange={e => patch({ slippage: Number(e.target.value) })} />
              </Row>
              <div className="opt-toggle-row">
                <span className="opt-label">Auto fee <span className="opt-sublabel">(override manual values)</span></span>
                <input type="checkbox" checked={settings.autoFee} onChange={e => patch({ autoFee: e.target.checked })} />
              </div>
              <Row label="Auto level">
                <select value={settings.autoFeeLevel} disabled={!settings.autoFee} onChange={e => patch({ autoFeeLevel: e.target.value as TradeSettings['autoFeeLevel'] })}>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                  <option value="turbo">Turbo</option>
                </select>
              </Row>
              <Row label={`Priority fee SOL${settings.autoFee ? ' (auto)' : ''}`}>
                <input type="number" min="0" max="0.1" step="0.0001" value={settings.priorityFee} disabled={settings.autoFee} onChange={e => patch({ priorityFee: Number(e.target.value) })} />
              </Row>
              <Row label={`Jito tip SOL${settings.autoFee ? ' (auto)' : ''}`}>
                <input type="number" min="0" max="0.1" step="0.0001" value={settings.jitoTip} disabled={settings.autoFee} onChange={e => patch({ jitoTip: Number(e.target.value) })} />
              </Row>
              <Row label="Auto fee max SOL">
                <input type="number" min="0.0001" max="0.1" step="0.0001" value={settings.autoFeeMax} disabled={!settings.autoFee} onChange={e => patch({ autoFeeMax: Number(e.target.value) })} />
              </Row>
            </section>
          </div>
        )}

        {tab === 'wallet' && (
          <div className="opt-panel-grid">
            <section className="opt-card">
              <h3 className="opt-card-title">Hot wallet status</h3>
              <div className={`opt-wallet-state ${hotWallet.unlocked ? 'opt-wallet-unlocked' : hotWallet.hasWallet ? 'opt-wallet-locked' : 'opt-wallet-none'}`}>
                <div className="opt-wallet-state-dot" />
                <div>
                  <div className="opt-wallet-state-label">{hotWallet.unlocked ? 'Unlocked' : hotWallet.hasWallet ? 'Locked' : 'Not imported'}</div>
                  {hotWallet.publicKey && <div className="opt-wallet-pubkey">{hotWallet.publicKey}</div>}
                </div>
              </div>
              <div className="opt-wallet-actions">
                {hotWallet.hasWallet && !hotWallet.unlocked && (
                  <>
                    <Row label="Password">
                      <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
                    </Row>
                    <button className="opt-btn-action" onClick={unlockHotWallet}>Unlock</button>
                  </>
                )}
                {hotWallet.unlocked && (
                  <button className="opt-btn-ghost-sm" onClick={lockHotWallet}>Lock</button>
                )}
                {hotWallet.hasWallet && (
                  <button className="opt-btn-danger" onClick={forgetHotWallet}>Forget wallet</button>
                )}
              </div>
            </section>

            <section className="opt-card">
              <h3 className="opt-card-title">Import new wallet</h3>
              <div className="opt-callout">Instant no-popup signing. Key is encrypted with your password and stored locally in Chrome storage only.</div>
              <Row label="Secret key">
                <textarea
                  value={secretKey}
                  onChange={e => setSecretKey(e.target.value)}
                  placeholder={'base58 · 0x hex · [12,34,...] · {"secretKey":[...]}'}
                  spellCheck={false}
                />
              </Row>
              <Row label="Password">
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Encrypt with password" />
              </Row>
              <button className="opt-btn-action" onClick={importHotWallet}>Import and unlock</button>
            </section>

            <section className="opt-card opt-card-info">
              <h3 className="opt-card-title">Local-only security</h3>
              <div className="opt-flow">
                <FlowItem title="Storage" body="Encrypted key lives in chrome.storage.local on this device only. Never sent anywhere." />
                <FlowItem title="Signing" body="All signing happens inside the extension background worker. Raw key never leaves the extension." />
                <FlowItem title="Session" body="Unlocked key bytes live only in chrome.storage.session — cleared on browser restart." />
              </div>
            </section>
          </div>
        )}

        {tab === 'controls' && (
          <div className="opt-panel-grid opt-panel-grid-narrow">
            <section className="opt-card">
              <h3 className="opt-card-title">Trade controls</h3>
              <ToggleRow label="Confirmation dialog" sub="Show confirm before every trade" checked={settings.confirmation} onChange={v => patch({ confirmation: v })} />
              <ToggleRow label="MEV protection" sub="Adds slippage guard on buy" checked={settings.protection} onChange={v => patch({ protection: v })} />
              <ToggleRow label="Hotkeys" sub="1–4 buy · Q/W/E/R sell" checked={settings.hotkeys} onChange={v => patch({ hotkeys: v })} />
            </section>
          </div>
        )}

        {tab === 'history' && (
          <div className="opt-panel-grid">
            <section className="opt-card">
              <h3 className="opt-card-title">Index wallet history</h3>
              <p className="opt-hint">Scan up to 200 recent transactions to recover cost basis and realized PnL for an existing position.</p>
              <Row label="Wallet address">
                <input value={indexWallet} onChange={e => setIndexWallet(e.target.value)} placeholder={settings.localWalletPublicKey || 'Wallet public key'} spellCheck={false} />
              </Row>
              <Row label="Token mint">
                <input value={indexMint} onChange={e => setIndexMint(e.target.value)} placeholder="Token mint address" spellCheck={false} />
              </Row>
              <button className="opt-btn-action" disabled={indexStatus.state === 'running'} onClick={() => void indexHistory()}>
                {indexStatus.state === 'running' ? 'Scanning…' : 'Scan history'}
              </button>
              {indexStatus.text && <div className={`opt-result opt-result-${indexStatus.state === 'running' ? 'testing' : indexStatus.state}`}>{indexStatus.text}</div>}
            </section>

            <section className="opt-card opt-card-info">
              <h3 className="opt-card-title">How it works</h3>
              <div className="opt-flow">
                <FlowItem title="Scan" body="Fetches up to 200 confirmed transactions for your wallet from the configured RPC." />
                <FlowItem title="Match" body="Filters Jupiter and Pump swap instructions that involve the token mint." />
                <FlowItem title="Recover" body="Reconstructs cost basis and realized PnL from pre/post token balance deltas." />
                <FlowItem title="Save" body="Writes recovered data to local storage so the widget shows correct PnL from first load." />
              </div>
            </section>
          </div>
        )}
      </div>

      <footer className="opt-footer">
        <CheckCircle2 size={13} className={saved ? 'opt-saved-icon' : 'opt-saved-icon opt-saved-dim'} />
        <span className="opt-footer-text">{saved ? 'All changes saved' : 'Unsaved changes'}</span>
        <button className="opt-btn-ghost" onClick={reset}><RotateCcw size={13} /> Reset</button>
        <button className="opt-btn-primary" onClick={save}><Save size={13} /> Save</button>
      </footer>
    </main>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="opt-row">
      <span className="opt-label">{props.label}</span>
      {props.children}
    </label>
  );
}

function ToggleRow(props: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="opt-toggle-row-full">
      <div>
        <div className="opt-toggle-label">{props.label}</div>
        <div className="opt-toggle-sub">{props.sub}</div>
      </div>
      <input type="checkbox" checked={props.checked} onChange={e => props.onChange(e.target.checked)} />
    </label>
  );
}

function ProviderLink(props: { href: string; label: string; note: string }) {
  return (
    <a className="opt-link-row" href={props.href} target="_blank" rel="noreferrer">
      <span className="opt-link-label">{props.label}</span>
      <span className="opt-link-note">{props.note}</span>
      <ExternalLink size={12} />
    </a>
  );
}

function FlowItem(props: { title: string; body: string }) {
  return (
    <div className="opt-flow-item">
      <span className="opt-flow-title">{props.title}</span>
      <span className="opt-flow-body">{props.body}</span>
    </div>
  );
}

function shortKey(v?: string) {
  return v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
}

async function measureRpc(rpcUrl: string) {
  const t = performance.now();
  const health = await rpcCall<string>(rpcUrl, 'getHealth');
  const slot   = await rpcCall<number>(rpcUrl, 'getSlot');
  return { health, slot, ms: Math.round(performance.now() - t) };
}

async function rpcCall<T>(rpcUrl: string, method: string): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `trench-${method}`, method }),
  });
  const p = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!res.ok)         throw new Error(p?.error?.message ?? `HTTP ${res.status}`);
  if (p?.error)        throw new Error(p.error.message ?? 'RPC error');
  if (p?.result === undefined) throw new Error('No result');
  return p.result;
}

function hotWalletRequest(msg: unknown): Promise<HotWalletResponse> {
  return new Promise(res => chrome.runtime.sendMessage(msg, (r: unknown) => res(r as HotWalletResponse)));
}

function parseNumberList(value: string, fallback: number[], max: number) {
  const parsed = value.split(/[\s,]+/).map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0).slice(0, max);
  return parsed.length ? parsed : fallback;
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
