import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, CheckCircle2, Copy, KeyRound, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Trash2, Users, Wallet } from 'lucide-react';
import { defaultSettings, loadExtensionSettings, resetExtensionSettings, saveExtensionSettings } from './storage';
import type { EvmAccountsResponse, TradeSettings } from './types';
import './options.css';

type Tab = 'wallets' | 'trade';
const RH_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const RH_USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'wallets', label: 'Wallets', icon: <Wallet size={14} /> },
  { id: 'trade', label: 'Trade', icon: <SlidersHorizontal size={14} /> },
];

function OptionsApp() {
  const [tab, setTab] = useState<Tab>('wallets');
  const [settings, setSettings] = useState<TradeSettings>(defaultSettings);
  const [saved, setSaved] = useState(true);
  const [evmAccounts, setEvmAccounts] = useState<EvmAccountsResponse>({ ok: true, accounts: [], activeAccountId: null, selectedAccountIds: [] });
  const [evmName, setEvmName] = useState('');
  const [evmMode, setEvmMode] = useState<'create' | 'import'>('create');
  const [createdAccountId, setCreatedAccountId] = useState('');
  const [evmKey, setEvmKey] = useState('');
  const [evmErr, setEvmErr] = useState('');
  const [evmNotice, setEvmNotice] = useState('');
  const [evmBusy, setEvmBusy] = useState(false);
  const [evmBalances, setEvmBalances] = useState<Record<string, { eth: number; usdg: number; unavailable?: boolean }>>({});
  const refreshSequence = useRef(0);

  const refreshEvmAccounts = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const result = await evmAccountsRequest({ type: 'TRENCH_EVM_ACCOUNTS_LIST' });
    if (sequence !== refreshSequence.current) return;
    if (!result.ok && !result.legacyRecoveryRequired) {
      setEvmErr(result.error ?? 'Unable to load Robinhood wallets');
      return;
    }
    setEvmAccounts(result);
    setEvmErr(result.ok ? '' : result.error ?? 'Unable to load Robinhood wallets');
    const entries = await Promise.all(result.accounts.map(async (account) => {
      try { return [account.id, await fetchEvmBalances(account.address)] as const; }
      catch { return [account.id, { eth: 0, usdg: 0, unavailable: true }] as const; }
    }));
    if (sequence === refreshSequence.current) setEvmBalances(Object.fromEntries(entries));
  }, []);

  async function importEvmWallet() {
    let pk = evmKey.trim();
    if (!pk.startsWith('0x')) pk = '0x' + pk;
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { setEvmErr('Invalid key — must be 0x + 64 hex chars'); return; }

    setEvmBusy(true); setEvmErr(''); setEvmNotice('');
    try {
      const result = await evmAccountsRequest({ type: 'TRENCH_EVM_ACCOUNT_IMPORT', name: evmName, privateKey: pk });
      if (!result.ok) { setEvmErr(result.error ?? 'Import failed'); return; }
      setEvmKey('');
      setEvmName('');
      setEvmAccounts(result);
      refreshSequence.current += 1;
      void refreshEvmAccounts();
    } finally {
      setEvmBusy(false);
    }
  }

  async function createEvmWallet() {
    if (evmAccounts.legacyRecoveryRequired) {
      setEvmErr('Recover the legacy wallet before creating another wallet');
      return;
    }
    setEvmBusy(true); setEvmErr(''); setEvmNotice('');
    try {
      const result = await evmAccountsRequest({ type: 'TRENCH_EVM_ACCOUNT_CREATE', name: evmName });
      if (!result.ok) { setEvmErr(result.error ?? 'Create failed'); return; }
      setEvmName('');
      setEvmAccounts(result);
      setCreatedAccountId(result.createdAccountId ?? '');
      refreshSequence.current += 1;
      void refreshEvmAccounts();
    } finally {
      setEvmBusy(false);
    }
  }

  async function mutateEvmAccounts(message: unknown) {
    setEvmNotice('');
    const result = await evmAccountsRequest(message);
    if (!result.ok) { setEvmErr(result.error ?? 'Wallet update failed'); return; }
    setEvmAccounts(result);
    void refreshEvmAccounts();
  }

  async function copyCreatedKey() {
    await copyAccountKey(createdAccountId);
  }

  async function copyAccountKey(accountId: string) {
    try {
      const result = await evmAccountsRequest({ type: 'TRENCH_EVM_ACCOUNT_EXPORT', accountId });
      if (!result.ok || !result.privateKey) {
        setEvmErr(result.error ?? 'Unable to export the wallet key');
        return;
      }
      await navigator.clipboard.writeText(result.privateKey);
      setEvmErr('');
      setEvmNotice('Private key copied. Store the backup securely.');
    } catch (error) {
      setEvmErr(error instanceof Error ? error.message : 'Unable to copy the wallet key');
    }
  }

  useEffect(() => {
    void loadExtensionSettings().then(setSettings);
    void refreshEvmAccounts();
  }, [refreshEvmAccounts]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refreshEvmAccounts();
    };
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('pageshow', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(() => void refreshEvmAccounts(), 10_000);

    return () => {
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('pageshow', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.clearInterval(interval);
    };
  }, [refreshEvmAccounts]);

  function patch(value: Partial<TradeSettings>) {
    setSettings((current) => ({ ...current, ...value }));
    setSaved(false);
  }

  async function save() {
    await saveExtensionSettings(settings);
    setSaved(true);
  }

  async function reset() {
    const defaults = await resetExtensionSettings();
    setSettings(defaults);
    setSaved(true);
  }

  const activeEvmAccount = evmAccounts.accounts.find((account) => account.id === evmAccounts.activeAccountId);
  const activeEvmBalance = activeEvmAccount ? evmBalances[activeEvmAccount.id] : undefined;

  return (
    <main className="opt-shell">
      <header className="opt-header">
        <div className="opt-logo">TR</div>
        <div className="opt-title-block">
          <span className="opt-eyebrow">Robinhood Chain execution</span>
          <span className="opt-title">Trench settings</span>
        </div>
        <div className="opt-header-right">
          {tab === 'trade' && !saved && <span className="opt-unsaved">Unsaved</span>}
          {tab === 'trade' && <button className="opt-btn-ghost" type="button" onClick={reset}><RotateCcw size={13} /> Reset</button>}
          {tab === 'trade' && <button className="opt-btn-primary" type="button" onClick={save}><Save size={13} /> Save changes</button>}
        </div>
      </header>

      <section className="opt-command-strip">
        <StatusTile label="RH active" value={activeEvmAccount?.name ?? 'Not ready'} state={activeEvmAccount ? 'ok' : 'warn'} />
        <StatusTile label="ETH" value={activeEvmBalance ? activeEvmBalance.eth.toFixed(5) : 'No balance'} state={activeEvmBalance ? 'ok' : 'warn'} />
        <StatusTile label="Batch" value={`${evmAccounts.selectedAccountIds.length} / ${evmAccounts.accounts.length} wallets`} state={evmAccounts.selectedAccountIds.length ? 'ok' : 'warn'} />
        <StatusTile label="Storage" value="Device encrypted" state="ok" />
        <div className={`opt-run-state ${activeEvmAccount ? 'opt-run-ok' : 'opt-run-warn'}`}>
          <CheckCircle2 size={14} />
          <span>{activeEvmAccount ? 'Robinhood ready' : 'Add a Robinhood wallet'}</span>
        </div>
      </section>

      <nav className="opt-tabs">
        {TABS.map((item) => (
          <button key={item.id} className={`opt-tab${tab === item.id ? ' opt-tab-active' : ''}`} type="button" onClick={() => setTab(item.id)}>
            {item.icon}{item.label}
          </button>
        ))}
      </nav>

      <div className="opt-body">
        {tab === 'wallets' && (
          <div className="opt-wallet-desk">
            <section className="opt-account-registry">
              <div className="opt-registry-head">
                <div>
                  <span className="opt-registry-kicker">Robinhood Chain</span>
                  <h2>Trading accounts</h2>
                   <p>Choose one active wallet for balances, then select the wallets that receive batch orders.</p>
                </div>
                <div className="opt-registry-count"><strong>{evmAccounts.accounts.length}</strong><span>/ 10</span></div>
              </div>
              <div className="opt-account-columns" aria-hidden="true">
                <span>Active</span><span>Batch</span><span>Account</span><span>Funds</span><span />
              </div>
              <div className="opt-account-list">
                {evmErr && <div className="opt-result opt-result-error">{evmErr}</div>}
                {evmNotice && <div className="opt-result opt-result-ok">{evmNotice}</div>}
                {evmAccounts.accounts.map((account) => {
                  const balance = evmBalances[account.id];
                  return (
                    <div className={`opt-account-row${account.active ? ' opt-account-active' : ''}`} key={account.id}>
                      <label className="opt-choice" title="Use for single trades">
                        <input type="radio" name="active-account" checked={account.active} onChange={() => void mutateEvmAccounts({ type: 'TRENCH_EVM_ACCOUNT_SET_ACTIVE', accountId: account.id })} />
                        <span />
                      </label>
                      <label className="opt-check" title="Include in batch trades">
                        <input type="checkbox" checked={account.selected} onChange={() => {
                          const ids = account.selected
                            ? evmAccounts.selectedAccountIds.filter((id) => id !== account.id)
                            : [...evmAccounts.selectedAccountIds, account.id];
                          if (!ids.length) return;
                          void mutateEvmAccounts({ type: 'TRENCH_EVM_ACCOUNTS_SET_SELECTED', accountIds: ids });
                        }} />
                        <span><Check size={11} /></span>
                      </label>
                      <button className="opt-account-main" type="button" onClick={() => void mutateEvmAccounts({ type: 'TRENCH_EVM_ACCOUNT_SET_ACTIVE', accountId: account.id })}>
                        <span className="opt-account-avatar">{account.name.slice(0, 2).toUpperCase()}</span>
                        <span><strong>{account.name}</strong><small>{shortAddress(account.address)}</small></span>
                      </button>
                      <div className="opt-account-funds">
                        <strong>{balance?.unavailable ? 'Unavailable' : balance ? `${balance.eth.toFixed(4)} ETH` : '...'}</strong>
                        <small>{balance?.unavailable ? 'RPC error' : balance ? `${balance.usdg.toFixed(2)} USDG` : 'Loading'}</small>
                      </div>
                      <div className="opt-account-actions">
                        <button className="opt-icon-export" type="button" title={`Copy ${account.name} private key`} onClick={() => void copyAccountKey(account.id)}><KeyRound size={13} /><span>Export</span></button>
                        <button className="opt-icon-danger" type="button" title={`Remove ${account.name}`} onClick={() => {
                          if (window.confirm(`Remove ${account.name} (${shortAddress(account.address)}) from Trench?`)) {
                            void mutateEvmAccounts({ type: 'TRENCH_EVM_ACCOUNT_REMOVE', accountId: account.id });
                          }
                        }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  );
                })}
                {!evmAccounts.accounts.length && (
                  <div className="opt-account-empty"><Users size={20} /><strong>No Robinhood accounts</strong><span>Create one or import an existing private key.</span></div>
                )}
              </div>
              <div className="opt-batch-bar">
                <span><Users size={13} /> {evmAccounts.selectedAccountIds.length} selected for batch</span>
                <button type="button" onClick={() => void mutateEvmAccounts({ type: 'TRENCH_EVM_ACCOUNTS_SET_SELECTED', accountIds: evmAccounts.accounts.map((account) => account.id) })}>Select all</button>
                <button type="button" onClick={() => void mutateEvmAccounts({ type: 'TRENCH_EVM_ACCOUNTS_SET_SELECTED', accountIds: evmAccounts.activeAccountId ? [evmAccounts.activeAccountId] : [] })}>Active only</button>
                <button type="button" onClick={() => void refreshEvmAccounts()}><RefreshCw size={12} /> Refresh</button>
              </div>
            </section>

            <aside className="opt-account-command">
              <div className="opt-command-tabs">
                <button className={evmMode === 'create' ? 'active' : ''} type="button" onClick={() => setEvmMode('create')}><Plus size={13} /> Create</button>
                <button className={evmMode === 'import' ? 'active' : ''} type="button" onClick={() => setEvmMode('import')}><Wallet size={13} /> Import</button>
              </div>
              {createdAccountId ? (
                <div className="opt-backup-panel">
                  <span className="opt-registry-kicker">Backup required</span>
                   <h3>Back up the new wallet</h3>
                   <p>Copy the private key directly to a secure password manager. Trench will not display it on the page.</p>
                  <button className="opt-btn-action" type="button" onClick={() => void copyCreatedKey()}><Copy size={13} /> Copy private key</button>
                  <button className="opt-btn-ghost-sm" type="button" onClick={() => setCreatedAccountId('')}>I stored the backup</button>
                </div>
              ) : (
                <div className="opt-create-panel">
                   <span className="opt-registry-kicker">Saved immediately</span>
                  <h3>{evmAccounts.legacyRecoveryRequired ? 'Recover legacy wallet' : evmMode === 'create' ? 'Create Robinhood wallet' : 'Import Robinhood wallet'}</h3>
                  {evmAccounts.passwordVaultArchived && <div className="opt-result">The previous encrypted vault was preserved locally. Re-import any wallet that is not listed.</div>}
                  {evmAccounts.legacyRecoveryRequired && <div className="opt-result opt-result-error">The legacy wallet encryption key is unavailable. Import that wallet's private key to recover it.</div>}
                  <label className="opt-row"><span className="opt-label">Account name</span><input value={evmName} maxLength={32} onChange={(event) => setEvmName(event.target.value)} placeholder={`Wallet ${evmAccounts.accounts.length + 1}`} /></label>
                  {(evmMode === 'import' || evmAccounts.legacyRecoveryRequired) && <label className="opt-row"><span className="opt-label">Private key</span><textarea value={evmKey} onChange={(event) => setEvmKey(event.target.value)} placeholder="0x + 64 hex characters" spellCheck={false} /></label>}
                  <button className="opt-btn-action" type="button" disabled={evmBusy || evmAccounts.accounts.length >= 10 || ((evmMode === 'import' || Boolean(evmAccounts.legacyRecoveryRequired)) && !evmKey.trim())} onClick={() => void (evmMode === 'create' && !evmAccounts.legacyRecoveryRequired ? createEvmWallet() : importEvmWallet())}>
                    {evmBusy ? 'Working...' : evmAccounts.legacyRecoveryRequired ? 'Recover wallet' : evmMode === 'create' ? 'Create wallet' : 'Import wallet'}
                  </button>
                   <div className="opt-security-copy"><ShieldCheck size={14} /><span>Wallet actions apply immediately. Keys stay encrypted in extension storage; trading pages receive only addresses and account IDs.</span></div>
                </div>
              )}
            </aside>
          </div>
        )}

        {tab === 'trade' && (
          <div className="opt-workspace">
            <section className="opt-main-card">
              <PanelTitle kicker="Quick trade" title="Button presets" />
              <PresetEditor label="Buy amounts" note="ETH per wallet" values={settings.buyAmounts} suffix="ETH" step={0.0001} onChange={(buyAmounts) => patch({
                buyAmounts,
                selectedBuyAmount: buyAmounts.includes(settings.selectedBuyAmount) ? settings.selectedBuyAmount : buyAmounts[0],
              })} />
              <PresetEditor label="Sell position" note="Percent per wallet" values={settings.sellPercents} suffix="%" step={1} max={100} onChange={(sellPercents) => patch({
                sellPercents,
                selectedSellPercent: sellPercents.includes(settings.selectedSellPercent) ? settings.selectedSellPercent : sellPercents[0],
              })} />
            </section>

            <section className="opt-main-card">
              <PanelTitle kicker="GMGN" title="Page controls" />
              <ToggleRow label="Show Trench on GMGN" sub="Overlay, card buttons and hotkeys" checked={settings.showOnGmgn} onChange={(value) => patch({ showOnGmgn: value })} />
              <ToggleRow label="Keyboard shortcuts" sub="1-4 buy / Q-W-E-R sell while Trench is active" checked={settings.hotkeys} onChange={(value) => patch({ hotkeys: value })} />
              <div className="opt-divider" />
              <RangeField label="Slippage %" value={settings.slippage} min={0} max={50} step={0.5} onChange={(value) => patch({ slippage: value })} />
            </section>
          </div>
        )}

      </div>

      {tab === 'trade' && <footer className="opt-footer">
        <CheckCircle2 size={13} className={saved ? 'opt-saved-icon' : 'opt-saved-icon opt-saved-dim'} />
        <span className="opt-footer-text">{saved ? 'All changes saved' : 'Unsaved changes'}</span>
        <button className="opt-btn-ghost" type="button" onClick={reset}><RotateCcw size={13} /> Reset</button>
        <button className="opt-btn-primary" type="button" onClick={save}><Save size={13} /> Save changes</button>
      </footer>}
    </main>
  );
}

function PanelTitle(props: { kicker: string; title: string; compact?: boolean }) {
  return (
    <div className={props.compact ? 'opt-panel-title opt-panel-title-compact' : 'opt-panel-title'}>
      <span>{props.kicker}</span>
      <h2>{props.title}</h2>
    </div>
  );
}

function StatusTile(props: { label: string; value: string; state: 'ok' | 'warn' }) {
  return (
    <div className={`opt-status-tile opt-status-${props.state}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function PresetEditor(props: { label: string; note: string; values: number[]; suffix: string; step: number; max?: number; onChange: (values: number[]) => void }) {
  const [drafts, setDrafts] = useState(() => props.values.map(String));

  useEffect(() => setDrafts(props.values.map(String)), [props.values]);

  function update(index: number, draft: string) {
    setDrafts((current) => current.map((value, itemIndex) => itemIndex === index ? draft : value));
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const next = [...props.values];
    next[index] = props.max ? Math.min(props.max, parsed) : parsed;
    props.onChange(next);
  }

  return (
    <fieldset className="opt-preset-editor">
      <legend><strong>{props.label}</strong><span>{props.note}</span></legend>
      <div className="opt-preset-grid">
        {props.values.map((value, index) => (
          <label key={index}>
            <span>{index + 1}</span>
            <input
              type="number"
              min={props.step}
              max={props.max}
              step={props.step}
              value={drafts[index] ?? String(value)}
              onChange={(event) => update(index, event.target.value)}
              onBlur={() => setDrafts(props.values.map(String))}
            />
            <small>{props.suffix}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RangeField(props: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="opt-range-row">
      <span className="opt-label">{props.label}</span>
      <input type="number" min={props.min} max={props.max} step={props.step} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  );
}

function ToggleRow(props: { label: string; sub: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="opt-toggle-row-full">
      <div>
        <div className="opt-toggle-label">{props.label}</div>
        <div className="opt-toggle-sub">{props.sub}</div>
      </div>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
    </label>
  );
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function evmAccountsRequest(message: unknown): Promise<EvmAccountsResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        resolve((response as EvmAccountsResponse) ?? {
          ok: false,
          accounts: [],
          activeAccountId: null,
          selectedAccountIds: [],
          error: runtimeError?.message ?? 'Extension unavailable',
        });
      });
    } catch (error) {
      resolve({
        ok: false,
        accounts: [],
        activeAccountId: null,
        selectedAccountIds: [],
        error: error instanceof Error ? error.message : 'Extension unavailable',
      });
    }
  });
}

async function fetchEvmBalances(address: string): Promise<{ eth: number; usdg: number }> {
  const ethHex = await evmRpcCall(RH_RPC_URL, 'eth_getBalance', [address, 'latest']);
  const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
  const usdgHex = await evmRpcCall(RH_RPC_URL, 'eth_call', [{ to: RH_USDG_ADDRESS, data }, 'latest']);
  const eth = ethHex ? Number(BigInt(ethHex)) / 1e18 : 0;
  const usdg = usdgHex && usdgHex !== '0x' ? Number(BigInt(usdgHex)) / 1e6 : 0;
  return { eth, usdg };
}

async function evmRpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = (await response.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
  if (payload?.error) throw new Error(payload.error.message ?? 'RPC error');
  if (!payload?.result) throw new Error(`RPC ${method} returned no result`);
  return payload.result;
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
