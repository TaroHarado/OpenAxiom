import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, Coins, ExternalLink, Gauge, History, LockKeyhole, RefreshCw, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Wallet, Zap } from 'lucide-react';
import { defaultSettings, DRPC_RPC_URL, getActiveRpcUrl, HELIUS_RPC_TEMPLATE, JITO_MAINNET_TRANSACTION_URL, loadExtensionSettings, PUBLIC_TEST_RPC_URL, PUBLICNODE_RPC_URL, resetExtensionSettings, saveExtensionSettings, SHYFT_RPC_TEMPLATE } from './storage';
import type { EvmWalletResponse, HotWalletResponse, IndexHistoryResponse, TradeSettings } from './types';
import './options.css';

type Tab = 'setup' | 'wallets' | 'trade' | 'history' | 'advanced';
type SpeedPreset = 'balanced' | 'fast' | 'turbo';

const RH_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const RH_USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'setup', label: 'Setup', icon: <Zap size={14} /> },
  { id: 'wallets', label: 'Wallets', icon: <Wallet size={14} /> },
  { id: 'trade', label: 'Trade', icon: <SlidersHorizontal size={14} /> },
  { id: 'history', label: 'History', icon: <History size={14} /> },
  { id: 'advanced', label: 'Advanced', icon: <ShieldCheck size={14} /> },
];

function OptionsApp() {
  const [tab, setTab] = useState<Tab>('setup');
  const [settings, setSettings] = useState<TradeSettings>(defaultSettings);
  const [saved, setSaved] = useState(true);
  const [rpcStatus, setRpcStatus] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });
  const [secretKey, setSecretKey] = useState('');
  const [showKeyImport, setShowKeyImport] = useState(false);
  const [hotWallet, setHotWallet] = useState<HotWalletResponse>({ ok: true, hasWallet: false, unlocked: false });
  const [indexMint, setIndexMint] = useState('');
  const [indexWallet, setIndexWallet] = useState('');
  const [indexStatus, setIndexStatus] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });
  const [evmWallet, setEvmWallet] = useState<EvmWalletResponse>({ ok: true, hasWallet: false, unlocked: false });
  const [evmKey, setEvmKey] = useState('');
  const [evmErr, setEvmErr] = useState('');
  const [evmBusy, setEvmBusy] = useState(false);
  const [evmBal, setEvmBal] = useState<{ eth: number; usdg: number } | null>(null);

  const refreshHotWallet = useCallback(async () => {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_REFRESH' });
    setHotWallet(result);
    if (result.unlocked && result.publicKey) setSettings(await loadExtensionSettings());
  }, []);

  const refreshEvmBalances = useCallback(async (address: string) => {
    try {
      const balances = await fetchEvmBalances(address);
      setEvmBal(balances);
    } catch {
      setEvmBal(null);
    }
  }, []);

  const refreshEvmWallet = useCallback(async () => {
    const result = await evmWalletRequest({ type: 'TRENCH_EVM_WALLET_STATUS' });
    setEvmWallet(result);
    if (result.address) void refreshEvmBalances(result.address);
    else setEvmBal(null);
  }, [refreshEvmBalances]);

  async function importEvmWallet() {
    let pk = evmKey.trim();
    if (!pk.startsWith('0x')) pk = '0x' + pk;
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { setEvmErr('Invalid key — must be 0x + 64 hex chars'); return; }
    setEvmBusy(true); setEvmErr('');
    const result = await evmWalletRequest({ type: 'TRENCH_EVM_WALLET_IMPORT', privateKey: pk });
    setEvmBusy(false);
    if (!result.ok) { setEvmErr(result.error ?? 'Import failed'); return; }
    setEvmKey('');
    setEvmWallet(result);
    if (result.address) void refreshEvmBalances(result.address);
  }

  async function forgetEvmWallet() {
    await evmWalletRequest({ type: 'TRENCH_EVM_WALLET_FORGET' });
    setEvmWallet({ ok: true, hasWallet: false, unlocked: false });
    setEvmBal(null);
    setEvmErr('');
  }

  useEffect(() => {
    void loadExtensionSettings().then(setSettings);
    void refreshHotWallet();
    void refreshEvmWallet();
  }, [refreshHotWallet, refreshEvmWallet]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refreshHotWallet();
    };
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('pageshow', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(() => void refreshHotWallet(), 10_000);

    return () => {
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('pageshow', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.clearInterval(interval);
    };
  }, [refreshHotWallet]);

  function patch(value: Partial<TradeSettings>) {
    setSettings((current) => ({ ...current, ...value }));
    setSaved(false);
  }

  async function save() {
    await saveExtensionSettings(settings);
    setSaved(true);
    await refreshHotWallet();
  }

  async function reset() {
    const defaults = await resetExtensionSettings();
    setSettings(defaults);
    setSaved(true);
    await refreshHotWallet();
  }

  function applySpeedPreset(preset: SpeedPreset) {
    if (preset === 'balanced') {
      patch({ autoFee: true, autoFeeLevel: 'normal', sendMode: 'rpc', jitoBundleOnly: false });
      return;
    }
    if (preset === 'fast') {
      patch({ autoFee: true, autoFeeLevel: 'fast', sendMode: 'jito', jitoBundleOnly: false });
      return;
    }
    patch({ autoFee: true, autoFeeLevel: 'turbo', sendMode: 'jito', jitoBundleOnly: true });
  }

  async function testRpc() {
    setRpcStatus({ state: 'testing', text: 'Testing...' });
    try {
      const result = await measureRpc(getActiveRpcUrl(settings));
      setRpcStatus({ state: 'ok', text: `${result.health} / slot ${result.slot.toLocaleString()} / ${result.ms} ms` });
    } catch (error) {
      setRpcStatus({ state: 'error', text: error instanceof Error ? error.message : 'RPC test failed' });
    }
  }

  async function importHotWallet() {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_IMPORT', secretKey });
    setHotWallet(result);
    if (!result.ok) return;
    setSecretKey('');
    setShowKeyImport(false);
    if (result.publicKey) await applyAndSave({ signerMode: 'local', localWalletPublicKey: result.publicKey });
    void refreshHotWallet();
  }

  async function unlockHotWallet() {
    const result = await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_UNLOCK' });
    setHotWallet(result);
    if (!result.ok) return;
    if (result.publicKey) await applyAndSave({ signerMode: 'local', localWalletPublicKey: result.publicKey });
  }

  async function lockHotWallet() {
    setHotWallet(await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_LOCK' }));
  }

  async function forgetHotWallet() {
    setHotWallet(await hotWalletRequest({ type: 'TRENCH_HOT_WALLET_FORGET' }));
    setShowKeyImport(true);
    await applyAndSave({ signerMode: 'wallet', localWalletPublicKey: '' });
  }

  async function applyAndSave(value: Partial<TradeSettings>) {
    const next = { ...settings, ...value };
    setSettings(next);
    await saveExtensionSettings(next);
    setSaved(true);
  }

  async function indexHistory() {
    const wallet = indexWallet.trim() || settings.localWalletPublicKey;
    const mint = indexMint.trim();
    if (!wallet) { setIndexStatus({ state: 'error', text: 'No wallet address.' }); return; }
    if (!mint) { setIndexStatus({ state: 'error', text: 'Enter token mint.' }); return; }

    setIndexStatus({ state: 'running', text: 'Scanning...' });
    try {
      const result = await new Promise<IndexHistoryResponse>((resolve) => {
        chrome.runtime.sendMessage({ type: 'TRENCH_INDEX_HISTORY', wallet, mint, settings }, (response: unknown) => resolve(response as IndexHistoryResponse));
      });
      setIndexStatus(result.ok
        ? { state: 'ok', text: `${result.scanned} txs scanned / ${result.matched} matched / cost ${result.costBasisSol.toFixed(4)} SOL / PnL ${result.realizedPnlSol.toFixed(4)} SOL` }
        : { state: 'error', text: result.error ?? 'Index failed' });
    } catch (error) {
      setIndexStatus({ state: 'error', text: error instanceof Error ? error.message : 'Index failed' });
    }
  }

  const speed = getSpeedPreset(settings);
  const walletReady = settings.signerMode === 'wallet' || hotWallet.unlocked;
  const currentWallet = hotWallet.publicKey || settings.localWalletPublicKey;
  const walletBalance = hotWallet.walletSol === undefined ? (hotWallet.balanceError ? 'Balance error' : 'No balance') : formatSol(hotWallet.walletSol);
  const runLabel = walletReady ? 'Ready to trade' : 'Import or unlock wallet';
  const shouldShowKeyImport = !hotWallet.hasWallet || showKeyImport;

  return (
    <main className="opt-shell">
      <header className="opt-header">
        <div className="opt-logo">TR</div>
        <div className="opt-title-block">
          <span className="opt-eyebrow">Built by traders, for traders</span>
          <span className="opt-title">Control room</span>
        </div>
        <div className="opt-header-right">
          {!saved && <span className="opt-unsaved">Unsaved</span>}
          <button className="opt-btn-ghost" type="button" onClick={reset}><RotateCcw size={13} /> Reset</button>
          <button className="opt-btn-primary" type="button" onClick={save}><Save size={13} /> Save</button>
        </div>
      </header>

      <section className="opt-command-strip">
        <StatusTile label="Wallet" value={walletReady ? signerLabel(settings, hotWallet) : 'Not ready'} state={walletReady ? 'ok' : 'warn'} />
        <StatusTile label="Balance" value={walletBalance} state={hotWallet.walletSol === undefined ? 'warn' : 'ok'} />
        <StatusTile label="Speed" value={speed.toUpperCase()} state={speed === 'turbo' ? 'warn' : 'ok'} />
        <StatusTile label="Route" value={settings.executionMode.toUpperCase()} state="ok" />
        <StatusTile label="Fees" value="0% always" state="ok" />
        <div className={`opt-run-state ${walletReady ? 'opt-run-ok' : 'opt-run-warn'}`}>
          <CheckCircle2 size={14} />
          <span>{runLabel}</span>
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
        {tab === 'setup' && (
          <div className="opt-workspace">
            <section className="opt-main-card">
              <PanelTitle kicker="Step 1" title="Choose how Trench signs" />
              <Segmented
                value={settings.signerMode}
                options={[
                  { value: 'local', label: 'Hot wallet', note: 'Instant, no popup' },
                  { value: 'wallet', label: 'Browser wallet', note: 'Phantom approval' },
                ]}
                onChange={(value) => patch({ signerMode: value as TradeSettings['signerMode'] })}
              />

              {settings.signerMode === 'local' && (
                <div className="opt-wallet-panel">
                  <div className={`opt-wallet-state ${hotWallet.unlocked ? 'opt-wallet-unlocked' : hotWallet.hasWallet ? 'opt-wallet-locked' : 'opt-wallet-none'}`}>
                    <div className="opt-wallet-state-dot" />
                    <div>
                      <div className="opt-wallet-state-label">{hotWallet.unlocked ? 'Unlocked' : hotWallet.hasWallet ? 'Locked' : 'No key imported'}</div>
                      {currentWallet && <div className="opt-wallet-pubkey">{currentWallet}</div>}
                      {currentWallet && <div className="opt-wallet-balance">SOL balance: {walletBalance}</div>}
                      {hotWallet.error && <div className="opt-wallet-error">{hotWallet.error}</div>}
                      {hotWallet.balanceError && <div className="opt-wallet-error">{hotWallet.balanceError}</div>}
                    </div>
                  </div>

                  {currentWallet && <button className="opt-btn-ghost-sm" type="button" onClick={refreshHotWallet}><RefreshCw size={12} /> Refresh balance</button>}
                  {!hotWallet.unlocked && hotWallet.hasWallet && <button className="opt-btn-action" type="button" onClick={unlockHotWallet}>Unlock local wallet</button>}
                  {hotWallet.unlocked && <button className="opt-btn-ghost-sm" type="button" onClick={lockHotWallet}>Lock wallet</button>}

                  {shouldShowKeyImport && (
                    <>
                      <label className="opt-row opt-row-tight">
                        <span className="opt-label">Private key</span>
                        <textarea value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Paste full base58 private key, JSON array, or exported secretKey" spellCheck={false} />
                      </label>
                      <button className="opt-btn-action" type="button" onClick={importHotWallet} disabled={!secretKey.trim()}>Import and use key</button>
                    </>
                  )}
                  {hotWallet.hasWallet && !showKeyImport && <button className="opt-btn-ghost-sm" type="button" onClick={() => setShowKeyImport(true)}>Replace key</button>}
                  {hotWallet.hasWallet && <button className="opt-btn-danger" type="button" onClick={forgetHotWallet}>Forget local key</button>}
                  <p className="opt-note"><LockKeyhole size={12} /> Device encrypted. Raw key is only kept in extension session while unlocked.</p>
                </div>
              )}
            </section>

            <section className="opt-main-card">
              <PanelTitle kicker="Step 2" title="Pick execution behavior" />
              <Segmented
                value={settings.executionMode}
                options={[
                  { value: 'auto', label: 'Auto', note: 'Best default' },
                  { value: 'jupiter', label: 'Jupiter', note: 'Aggregator' },
                  { value: 'pump', label: 'Pump', note: 'Bonding curve' },
                ]}
                onChange={(value) => patch({ executionMode: value as TradeSettings['executionMode'] })}
              />

              <div className="opt-divider" />

              <PanelTitle kicker="Step 3" title="Pick speed" compact />
              <Segmented
                value={speed}
                options={[
                  { value: 'balanced', label: 'Balanced', note: 'RPC preflight' },
                  { value: 'fast', label: 'Fast', note: 'Jito send' },
                  { value: 'turbo', label: 'Turbo', note: 'Jito bundle only' },
                ]}
                onChange={(value) => applySpeedPreset(value as SpeedPreset)}
              />
            </section>
          </div>
        )}

        {tab === 'wallets' && (
          <div className="opt-workspace">
            <section className="opt-main-card">
              <PanelTitle kicker="Solana" title="SOL hot wallet" />
              <div className="opt-wallet-panel">
                <div className={`opt-wallet-state ${hotWallet.unlocked ? 'opt-wallet-unlocked' : hotWallet.hasWallet ? 'opt-wallet-locked' : 'opt-wallet-none'}`}>
                  <div className="opt-wallet-state-dot" />
                  <div>
                    <div className="opt-wallet-state-label">{hotWallet.unlocked ? 'Unlocked' : hotWallet.hasWallet ? 'Locked' : 'No key imported'}</div>
                    {currentWallet && <div className="opt-wallet-pubkey">{currentWallet}</div>}
                    {currentWallet && <div className="opt-wallet-balance">Balance: {walletBalance}</div>}
                    {hotWallet.error && <div className="opt-wallet-error">{hotWallet.error}</div>}
                    {hotWallet.balanceError && <div className="opt-wallet-error">{hotWallet.balanceError}</div>}
                  </div>
                </div>

                {currentWallet && <button className="opt-btn-ghost-sm" type="button" onClick={refreshHotWallet}><RefreshCw size={12} /> Refresh balance</button>}
                {!hotWallet.unlocked && hotWallet.hasWallet && <button className="opt-btn-action" type="button" onClick={unlockHotWallet}>Unlock wallet</button>}
                {hotWallet.unlocked && <button className="opt-btn-ghost-sm" type="button" onClick={lockHotWallet}>Lock wallet</button>}

                {shouldShowKeyImport && (
                  <>
                    <label className="opt-row opt-row-tight">
                      <span className="opt-label">Private key</span>
                      <textarea value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="base58 · hex · bytes · JSON array" spellCheck={false} />
                    </label>
                    <button className="opt-btn-action" type="button" onClick={importHotWallet} disabled={!secretKey.trim()}>Import key</button>
                  </>
                )}
                {hotWallet.hasWallet && !showKeyImport && <button className="opt-btn-ghost-sm" type="button" onClick={() => setShowKeyImport(true)}>Replace key</button>}
                {hotWallet.hasWallet && <button className="opt-btn-danger" type="button" onClick={forgetHotWallet}>Forget key</button>}
                <p className="opt-note"><Coins size={12} /> Fund with <strong>SOL</strong> — it covers both trades and network fees.</p>
                <p className="opt-note"><LockKeyhole size={12} /> Device-encrypted. Signs Jupiter / Pump swaps on Solana.</p>
              </div>
            </section>

            <section className="opt-main-card">
              <PanelTitle kicker="Robinhood Chain" title="ERC-20 wallet" />
              <div className="opt-wallet-panel">
                <div className={`opt-wallet-state ${evmWallet.unlocked ? 'opt-wallet-unlocked' : evmWallet.hasWallet ? 'opt-wallet-locked' : 'opt-wallet-none'}`}>
                  <div className="opt-wallet-state-dot" />
                  <div>
                    <div className="opt-wallet-state-label">{evmWallet.hasWallet ? (evmWallet.unlocked ? 'Unlocked' : 'Locked') : 'No key imported'}</div>
                    {evmWallet.address && <div className="opt-wallet-pubkey">{evmWallet.address}</div>}
                    {evmBal && <div className="opt-wallet-balance">ETH {evmBal.eth.toFixed(5)} · USDG {evmBal.usdg.toFixed(2)}</div>}
                    {evmErr && <div className="opt-wallet-error">{evmErr}</div>}
                  </div>
                </div>

                {evmWallet.address && <button className="opt-btn-ghost-sm" type="button" onClick={() => evmWallet.address && refreshEvmBalances(evmWallet.address)}><RefreshCw size={12} /> Refresh balance</button>}

                {!evmWallet.hasWallet && (
                  <>
                    <label className="opt-row opt-row-tight">
                      <span className="opt-label">Private key</span>
                      <textarea value={evmKey} onChange={(event) => setEvmKey(event.target.value)} placeholder="0x + 64 hex characters" spellCheck={false} />
                    </label>
                    <button className="opt-btn-action" type="button" onClick={importEvmWallet} disabled={!evmKey.trim() || evmBusy}>{evmBusy ? 'Importing…' : 'Import key'}</button>
                  </>
                )}
                {evmWallet.hasWallet && <button className="opt-btn-danger" type="button" onClick={forgetEvmWallet}>Forget key</button>}
                <p className="opt-note"><Coins size={12} /> Fund with <strong>USDG</strong> to trade, plus a little <strong>ETH</strong> for gas.</p>
                <p className="opt-note"><LockKeyhole size={12} /> Device-encrypted. Signs Uniswap V3 swaps (USDG / ETH) on Robinhood Chain.</p>
              </div>
            </section>
          </div>
        )}

        {tab === 'trade' && (
          <div className="opt-workspace">
            <section className="opt-main-card">
              <PanelTitle kicker="Buttons" title="Amounts on the floating terminal" />
              <QuickList label="Buy buttons, SOL" values={settings.buyAmounts} suffix="" onChange={(value) => patch({ buyAmounts: parseNumberList(value, defaultSettings.buyAmounts, 4) })} />
              <QuickList label="Sell buttons" values={settings.sellPercents} suffix="%" onChange={(value) => patch({ sellPercents: parseNumberList(value, defaultSettings.sellPercents, 4).map((item) => Math.min(100, item)) })} />
            </section>

            <section className="opt-main-card">
              <PanelTitle kicker="Risk" title="Guardrails" />
              <RangeField label="Slippage %" value={settings.slippage} min={0} max={50} step={0.5} onChange={(value) => patch({ slippage: value })} />
              <ToggleRow label="Confirmation dialog" sub="Require one more click before sending a trade" checked={settings.confirmation} onChange={(value) => patch({ confirmation: value })} />
              <ToggleRow label="MEV protection" sub="Keep Trench guardrails active on buys" checked={settings.protection} onChange={(value) => patch({ protection: value })} />
              <ToggleRow label="Hotkeys" sub="1-4 buy / Q-W-E-R sell" checked={settings.hotkeys} onChange={(value) => patch({ hotkeys: value })} />
            </section>
          </div>
        )}

        {tab === 'history' && (
          <div className="opt-workspace">
            <section className="opt-main-card">
              <PanelTitle kicker="PnL" title="Recover a position" />
              <p className="opt-hint">Scan recent swaps to rebuild cost basis and realized PnL for a token already in the wallet.</p>
              <Row label="Wallet address">
                <input value={indexWallet} onChange={(event) => setIndexWallet(event.target.value)} placeholder={settings.localWalletPublicKey || 'Wallet public key'} spellCheck={false} />
              </Row>
              <Row label="Token mint">
                <input value={indexMint} onChange={(event) => setIndexMint(event.target.value)} placeholder="Token mint address" spellCheck={false} />
              </Row>
              <button className="opt-btn-action" type="button" disabled={indexStatus.state === 'running'} onClick={() => void indexHistory()}>
                {indexStatus.state === 'running' ? 'Scanning...' : 'Scan history'}
              </button>
              {indexStatus.text && <div className={`opt-result opt-result-${indexStatus.state === 'running' ? 'testing' : indexStatus.state}`}>{indexStatus.text}</div>}
            </section>

            <section className="opt-side-card">
              <PanelTitle kicker="What it reads" title="Local PnL index" />
              <FlowItem title="Scan" body="Fetches up to 200 confirmed wallet transactions from the configured RPC." />
              <FlowItem title="Match" body="Keeps Jupiter and Pump swaps that touch the mint." />
              <FlowItem title="Save" body="Writes the ledger locally so the widget loads with usable PnL." />
            </section>
          </div>
        )}

        {tab === 'advanced' && (
          <div className="opt-workspace opt-workspace-advanced">
            <section className="opt-main-card">
              <PanelTitle kicker="RPC" title="Raw network settings" />
              <Row label="Custom RPC URL">
                <input value={settings.rpcUrl} onChange={(event) => patch({ rpcUrl: event.target.value })} spellCheck={false} />
              </Row>
              <div className="opt-quick-btns">
                <button className="opt-btn-ghost-sm" type="button" onClick={() => patch({ rpcUrl: PUBLICNODE_RPC_URL })}>PublicNode</button>
                <button className="opt-btn-ghost-sm" type="button" onClick={() => patch({ rpcUrl: DRPC_RPC_URL })}>dRPC</button>
                <button className="opt-btn-ghost-sm" type="button" onClick={() => patch({ rpcUrl: PUBLIC_TEST_RPC_URL })}>Mainnet</button>
                <button className="opt-btn-ghost-sm" type="button" onClick={() => patch({ rpcUrl: HELIUS_RPC_TEMPLATE })}>Helius</button>
                <button className="opt-btn-ghost-sm" type="button" onClick={() => patch({ rpcUrl: SHYFT_RPC_TEMPLATE })}>Shyft</button>
                <button className="opt-btn-ghost-sm" type="button" onClick={testRpc}><Gauge size={12} /> Test active RPC</button>
              </div>
              {rpcStatus.text && <div className={`opt-result opt-result-${rpcStatus.state}`}>{rpcStatus.text}</div>}
            </section>

            <section className="opt-main-card">
              <PanelTitle kicker="Jito" title="Low latency send" />
              <Row label="Endpoint">
                <input value={settings.jitoEndpoint} onChange={(event) => patch({ jitoEndpoint: event.target.value })} spellCheck={false} />
              </Row>
              <div className="opt-quick-btns">
                <button className="opt-btn-ghost-sm" type="button" onClick={() => patch({ jitoEndpoint: JITO_MAINNET_TRANSACTION_URL })}>Mainnet default</button>
              </div>
              <ToggleRow label="Bundle only" sub="Reject if Jito cannot land the transaction" checked={settings.jitoBundleOnly} onChange={(value) => patch({ jitoBundleOnly: value })} />
              <RangeField label="Auto fee max SOL" value={settings.autoFeeMax} min={0.0001} max={0.1} step={0.0001} onChange={(value) => patch({ autoFeeMax: value })} />
              <RangeField label="Manual priority fee SOL" value={settings.priorityFee} min={0} max={0.1} step={0.0001} disabled={settings.autoFee} onChange={(value) => patch({ priorityFee: value })} />
              <RangeField label="Manual Jito tip SOL" value={settings.jitoTip} min={0} max={0.1} step={0.0001} disabled={settings.autoFee} onChange={(value) => patch({ jitoTip: value })} />
            </section>

            <section className="opt-side-card">
              <PanelTitle kicker="Providers" title="Free RPC keys" />
              <ProviderLink href="https://dashboard.helius.dev/" label="Helius" note="Free developer tier" />
              <ProviderLink href="https://shyft.to/get-api-key" label="Shyft" note="API key endpoint" />
              <ProviderLink href="https://www.quicknode.com/" label="QuickNode" note="Free endpoint tier" />
            </section>
          </div>
        )}
      </div>

      <footer className="opt-footer">
        <CheckCircle2 size={13} className={saved ? 'opt-saved-icon' : 'opt-saved-icon opt-saved-dim'} />
        <span className="opt-footer-text">{saved ? 'All changes saved' : 'Unsaved changes'}</span>
        <button className="opt-btn-ghost" type="button" onClick={reset}><RotateCcw size={13} /> Reset</button>
        <button className="opt-btn-primary" type="button" onClick={save}><Save size={13} /> Save</button>
      </footer>
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

function Segmented(props: { value: string; options: Array<{ value: string; label: string; note: string }>; onChange: (value: string) => void }) {
  return (
    <div className="opt-segmented">
      {props.options.map((option) => (
        <button key={option.value} type="button" className={`opt-segment${props.value === option.value ? ' opt-segment-active' : ''}`} onClick={() => props.onChange(option.value)}>
          <span>{option.label}</span>
          <small>{option.note}</small>
        </button>
      ))}
    </div>
  );
}

function QuickList(props: { label: string; values: number[]; suffix: string; onChange: (value: string) => void }) {
  return (
    <div className="opt-quick-list">
      <Row label={props.label}>
        <input value={props.values.join(' ')} onChange={(event) => props.onChange(event.target.value)} />
      </Row>
      <div className="opt-pill-preview">
        {props.values.map((value, index) => <span key={`${value}-${index}`} className="opt-pill">{value}{props.suffix}</span>)}
      </div>
    </div>
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

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="opt-row">
      <span className="opt-label">{props.label}</span>
      {props.children}
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

function signerLabel(settings: TradeSettings, wallet: HotWalletResponse) {
  if (settings.signerMode === 'wallet') return 'Browser wallet';
  return wallet.unlocked ? `Hot ${shortKey(wallet.publicKey)}` : 'Hot wallet';
}

function getSpeedPreset(settings: TradeSettings): SpeedPreset {
  if (settings.sendMode === 'jito' && settings.autoFeeLevel === 'turbo' && settings.jitoBundleOnly) return 'turbo';
  if (settings.sendMode === 'jito') return 'fast';
  return 'balanced';
}

function shortKey(value?: string) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
}

function formatSol(value: number) {
  if (value >= 1) return `${value.toFixed(3)} SOL`;
  if (value >= 0.001) return `${value.toFixed(5)} SOL`;
  return `${value.toFixed(9)} SOL`;
}

async function measureRpc(rpcUrl: string) {
  const started = performance.now();
  const health = await rpcCall<string>(rpcUrl, 'getHealth');
  const slot = await rpcCall<number>(rpcUrl, 'getSlot');
  return { health, slot, ms: Math.round(performance.now() - started) };
}

async function rpcCall<T>(rpcUrl: string, method: string): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `trench-${method}`, method }),
  });
  const payload = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  if (payload?.error) throw new Error(payload.error.message ?? 'RPC error');
  if (payload?.result === undefined) throw new Error('No result');
  return payload.result;
}

function hotWalletRequest(message: unknown): Promise<HotWalletResponse> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response: unknown) => resolve(response as HotWalletResponse)));
}

function evmWalletRequest(message: unknown): Promise<EvmWalletResponse> {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response: unknown) => resolve((response as EvmWalletResponse) ?? { ok: false, hasWallet: false, unlocked: false })));
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
  const payload = (await response.json().catch(() => null)) as { result?: string } | null;
  return payload?.result ?? '';
}

function parseNumberList(value: string, fallback: number[], max: number) {
  const parsed = value.split(/[\s,]+/).map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0).slice(0, max);
  return parsed.length ? parsed : fallback;
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
