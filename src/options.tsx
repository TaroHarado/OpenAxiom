import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ExternalLink, Gauge, KeyRound, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { defaultSettings, HELIUS_RPC_TEMPLATE, JITO_MAINNET_TRANSACTION_URL, loadExtensionSettings, PUBLIC_TEST_RPC_URL, resetExtensionSettings, saveExtensionSettings, SHYFT_RPC_TEMPLATE } from './storage';
import type { HotWalletResponse, TradeSettings } from './types';
import './options.css';

function OptionsApp() {
  const [settings, setSettings] = useState<TradeSettings>(defaultSettings);
  const [status, setStatus] = useState('Loading settings');
  const [rpcStatus, setRpcStatus] = useState<RpcStatus>({ state: 'idle', text: 'Not tested' });
  const [secretKey, setSecretKey] = useState('');
  const [password, setPassword] = useState('');
  const [hotWallet, setHotWallet] = useState<HotWalletResponse>({ ok: true, hasWallet: false, unlocked: false });

  useEffect(() => {
    void loadExtensionSettings().then((loaded) => {
      setSettings(loaded);
      setStatus('Ready');
    });
    void hotWalletRequest({ type: 'TRENCH_HOT_WALLET_STATUS' }).then(setHotWallet);
  }, []);

  function patch(patchValue: Partial<TradeSettings>) {
    setSettings((current) => ({ ...current, ...patchValue }));
    setStatus('Unsaved changes');
  }

  async function save() {
    await saveExtensionSettings(settings);
    setStatus('Saved');
  }

  async function reset() {
    const defaults = await resetExtensionSettings();
    setSettings(defaults);
    setStatus('Reset to defaults');
  }

  async function testRpc() {
    setRpcStatus({ state: 'testing', text: 'Testing RPC...' });

    try {
      const result = await measureRpc(settings.rpcUrl);
      setRpcStatus({ state: 'ok', text: `${result.health} / slot ${result.slot.toLocaleString()} / ${result.ms} ms` });
    } catch (error) {
      setRpcStatus({ state: 'error', text: error instanceof Error ? error.message : 'RPC test failed' });
    }
  }

  async function importHotWallet() {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_IMPORT', secretKey, password });
    setHotWallet(result);
    setSecretKey('');
    setPassword('');
    if (result.publicKey) await applyAndSave({ signerMode: 'local', localWalletPublicKey: result.publicKey });
    setStatus(result.ok ? 'Hot wallet imported' : result.error ?? 'Hot wallet import failed');
  }

  async function unlockHotWallet() {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_UNLOCK', password });
    setHotWallet(result);
    setPassword('');
    if (result.publicKey) await applyAndSave({ signerMode: 'local', localWalletPublicKey: result.publicKey });
    setStatus(result.ok ? 'Hot wallet unlocked' : result.error ?? 'Hot wallet unlock failed');
  }

  async function lockHotWallet() {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_LOCK' });
    setHotWallet(result);
    setStatus('Hot wallet locked');
  }

  async function forgetHotWallet() {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_FORGET' });
    setHotWallet(result);
    await applyAndSave({ signerMode: 'wallet', localWalletPublicKey: '' });
    setStatus('Hot wallet forgotten');
  }

  async function applyAndSave(patchValue: Partial<TradeSettings>) {
    const next = { ...settings, ...patchValue };
    setSettings(next);
    await saveExtensionSettings(next);
  }

  return (
    <main className="options-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Trench for Axiom</p>
          <h1>Execution Settings</h1>
          <p className="subcopy">Configure the floating trading overlay. Use browser-wallet approval mode, or import a local hot wallet for no-popup execution.</p>
        </div>
        <div className="status-pill"><CheckCircle2 size={16} /> {status}</div>
      </section>

      <section className="settings-layout">
        <Panel icon={<Zap size={18} />} title="Execution">
          <Field label="Engine">
            <select value={settings.executionMode} onChange={(event) => patch({ executionMode: event.target.value as TradeSettings['executionMode'] })}>
              <option value="jupiter">Jupiter</option>
              <option value="pump">Pump</option>
              <option value="auto">Auto</option>
            </select>
          </Field>
          <Field label="Signer">
            <select value={settings.signerMode} onChange={(event) => patch({ signerMode: event.target.value as TradeSettings['signerMode'] })}>
              <option value="wallet">Browser wallet approval</option>
              <option value="local">Local hot wallet</option>
            </select>
          </Field>
          <div className="rpc-result rpc-idle">Hot wallet: {hotWallet.unlocked ? `unlocked ${shortKey(hotWallet.publicKey)}` : hotWallet.hasWallet ? `locked ${shortKey(hotWallet.publicKey)}` : 'not imported'}</div>
          <Field label="RPC URL">
            <input value={settings.rpcUrl} onChange={(event) => patch({ rpcUrl: event.target.value })} />
          </Field>
          <div className="button-stack">
            <button className="ghost" type="button" onClick={() => patch({ rpcUrl: PUBLIC_TEST_RPC_URL })}>Use public Solana RPC</button>
            <button className="ghost" type="button" onClick={() => patch({ rpcUrl: HELIUS_RPC_TEMPLATE })}>Use Helius template</button>
            <button className="ghost" type="button" onClick={() => patch({ rpcUrl: SHYFT_RPC_TEMPLATE })}>Use Shyft template</button>
            <button className="ghost" type="button" onClick={testRpc}><Gauge size={15} /> Test RPC</button>
          </div>
          <div className={`rpc-result rpc-${rpcStatus.state}`}>{rpcStatus.text}</div>
          <Field label="Send mode">
            <select value={settings.sendMode} onChange={(event) => patch({ sendMode: event.target.value as TradeSettings['sendMode'] })}>
              <option value="rpc">RPC preflight</option>
              <option value="jito">Jito low latency</option>
            </select>
          </Field>
          <Field label="Jito endpoint">
            <input value={settings.jitoEndpoint} onChange={(event) => patch({ jitoEndpoint: event.target.value })} />
          </Field>
          <div className="button-stack">
            <button className="ghost" type="button" onClick={() => patch({ jitoEndpoint: JITO_MAINNET_TRANSACTION_URL })}>Use Jito mainnet</button>
          </div>
          <Toggle label="Jito bundleOnly" checked={settings.jitoBundleOnly} onChange={(value) => patch({ jitoBundleOnly: value })} />
        </Panel>

        <Panel icon={<KeyRound size={18} />} title="Hot Wallet">
          <Field label="Secret key JSON">
            <textarea value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={'[12,34,...64 bytes] or {"secretKey":[...]}'} spellCheck={false} />
          </Field>
          <Field label="Local password">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <div className="button-stack">
            <button className="ghost" type="button" onClick={importHotWallet}>Import and unlock</button>
            <button className="ghost" type="button" onClick={unlockHotWallet}>Unlock</button>
            <button className="ghost" type="button" onClick={lockHotWallet}>Lock</button>
            <button className="ghost danger" type="button" onClick={forgetHotWallet}>Forget local wallet</button>
          </div>
        </Panel>

        <Panel icon={<SlidersHorizontal size={18} />} title="Preset P3">
          <Field label="Buy amounts, SOL">
            <input value={settings.buyAmounts.join(' ')} onChange={(event) => patch({ buyAmounts: parseNumberList(event.target.value, defaultSettings.buyAmounts, 4) })} />
          </Field>
          <Field label="Sell percentages">
            <input value={settings.sellPercents.join(' ')} onChange={(event) => patch({ sellPercents: parseNumberList(event.target.value, defaultSettings.sellPercents, 4).map((value) => Math.min(100, value)) })} />
          </Field>
          <div className="two-col">
            <Field label="Slippage %">
              <input type="number" min="0" max="50" value={settings.slippage} onChange={(event) => patch({ slippage: Number(event.target.value) })} />
            </Field>
            <Field label="Priority fee SOL">
              <input type="number" min="0" max="0.1" step="0.0001" value={settings.priorityFee} onChange={(event) => patch({ priorityFee: Number(event.target.value) })} />
            </Field>
          </div>
          <Field label="Jito tip SOL">
            <input type="number" min="0" max="0.1" step="0.0001" value={settings.jitoTip} onChange={(event) => patch({ jitoTip: Number(event.target.value) })} />
          </Field>
        </Panel>

        <Panel icon={<ShieldCheck size={18} />} title="Controls">
          <Toggle label="Protection" checked={settings.protection} onChange={(value) => patch({ protection: value })} />
          <Toggle label="Confirmation" checked={settings.confirmation} onChange={(value) => patch({ confirmation: value })} />
          <Toggle label="Hotkeys" checked={settings.hotkeys} onChange={(value) => patch({ hotkeys: value })} />
        </Panel>
      </section>

      <section className="info-grid">
        <article className="info-panel">
          <h2><KeyRound size={18} /> Free keys</h2>
          <p>Use public Solana RPC without a key for quick tests. For steadier free-tier endpoints, create a developer key at one of these providers and paste the full URL above.</p>
          <div className="link-list">
            <ProviderLink href="https://dashboard.helius.dev/" label="Helius" note="Solana RPC free developer tier" />
            <ProviderLink href="https://shyft.to/get-api-key" label="Shyft" note="Solana RPC API key" />
            <ProviderLink href="https://www.quicknode.com/" label="QuickNode" note="Solana endpoint free tier" />
            <ProviderLink href="https://admin.moralis.com/" label="Moralis" note="Data API for metadata, balances, history" />
          </div>
        </article>

        <article className="info-panel">
          <h2><ShieldCheck size={18} /> Local-only structure</h2>
          <div className="flow-list">
            <div><strong>Settings</strong><span>RPC URLs, API keys, and encrypted hot-wallet data stay in Chrome `storage.local` on this device.</span></div>
            <div><strong>Signing</strong><span>Browser wallet mode uses Phantom/Solflare. Hot-wallet mode signs locally inside the extension after unlock.</span></div>
            <div><strong>Execution</strong><span>Signed transactions go directly from this browser to your selected RPC or Jito endpoint.</span></div>
            <div><strong>Backend</strong><span>There is no Trench server, proxy, telemetry pipeline, or hosted transaction processor.</span></div>
          </div>
        </article>
      </section>

      <footer className="action-bar">
        <button className="secondary" type="button" onClick={reset}><RotateCcw size={16} /> Reset</button>
        <button className="primary" type="button" onClick={save}><Save size={16} /> Save settings</button>
      </footer>
    </main>
  );
}

type RpcStatus = {
  state: 'idle' | 'testing' | 'ok' | 'error';
  text: string;
};

async function measureRpc(rpcUrl: string) {
  const start = performance.now();
  const health = await rpcCall<string>(rpcUrl, 'getHealth');
  const slot = await rpcCall<number>(rpcUrl, 'getSlot');
  return { health, slot, ms: Math.round(performance.now() - start) };
}

async function rpcCall<T>(rpcUrl: string, method: string): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `trench-${method}`, method })
  });
  const payload = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;

  if (!response.ok) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  if (payload?.error) throw new Error(payload.error.message ?? 'RPC returned an error');
  if (payload?.result === undefined) throw new Error('RPC returned no result');
  return payload.result;
}

function hotWalletRequest(message: unknown): Promise<HotWalletResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => resolve(response as HotWalletResponse));
  });
}

function shortKey(value?: string) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
}

function Panel(props: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{props.icon}{props.title}</h2>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{props.label}</span>{props.children}</label>;
}

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
    </label>
  );
}

function ProviderLink(props: { href: string; label: string; note: string }) {
  return (
    <a href={props.href} target="_blank" rel="noreferrer">
      <span>{props.label}</span>
      <small>{props.note}</small>
      <ExternalLink size={14} />
    </a>
  );
}

function parseNumberList(value: string, fallback: number[], maxLength: number) {
  const parsed = value.split(/[\s,]+/).map((part) => Number(part.trim())).filter((part) => Number.isFinite(part) && part > 0).slice(0, maxLength);
  return parsed.length ? parsed : fallback;
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
