import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  History,
  Loader2,
  Settings,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import { parseAxiomMintFromUrl, readAxiomTokenContext } from './axiom';
import {
  defaultSettings,
  loadCollapsed,
  loadExtensionSettings,
  loadPosition,
  PUBLIC_TEST_RPC_URL,
  saveCollapsed,
  savePosition,
  saveSettings
} from './storage';
import type { PositionResponse, PositionState, ToastKind, TokenContext, TradeOrder, TradeResponse, TradeSettings, TradeSide } from './types';
import type { WalletBridgeRequest, WalletBridgeResponse } from './types';
import styles from './styles.css?inline';

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        getURL?: (path: string) => string;
        sendMessage?: (message: unknown, callback: (response: TradeResponse | PositionResponse) => void) => void;
      };
    };
  }
}

const ROOT_ID = 'trench-shadow-root';
const PULSE_STYLE_ID = 'trench-pulse-style';
const PULSE_BUTTON_CLASS = 'trench-pulse-buy';
const PNL_LEDGER_KEY = 'trench.pnl.v1';
const TRADE_HISTORY_KEY = 'trench.tradeHistory.v1';

type PnlLedger = {
  rawTokenAmount: string;
  costBasisSol: number;
  realizedPnlSol: number;
  updatedAt: number;
};

function mount() {
  if (document.getElementById(ROOT_ID)) return;
  console.info('[Trench] content script mounted', window.location.href);
  injectWalletBridge();
  initPulseQuickBuy();

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  const rootNode = document.createElement('div');
  shadow.appendChild(rootNode);

  createRoot(rootNode).render(<TrenchOverlay />);
}

function TrenchOverlay() {
  const [settingsState, setSettingsState] = useState<TradeSettings>(defaultSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [position, setPosition] = useState(() => clampPosition(loadPosition()));
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [token, setToken] = useState<TokenContext>(() => readAxiomTokenContext());
  const [orders, setOrders] = useState<TradeOrder[]>(() => loadTradeHistory());
  const [pendingSide, setPendingSide] = useState<TradeSide | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [positionState, setPositionState] = useState<PositionState>(() => emptyPosition(readAxiomTokenContext().symbol));
  const [pnlLedger, setPnlLedger] = useState<PnlLedger | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: ToastKind; text: string; signature?: string } | null>(null);
  const [flash, setFlash] = useState<ToastKind | null>(null);
  const [active, setActive] = useState(false);
  const dragRef = useRef({ dragging: false, dx: 0, dy: 0 });

  const displayedWallet = settingsState.signerMode === 'local' ? settingsState.localWalletPublicKey : wallet;

  useEffect(() => {
    void loadExtensionSettings().then((loaded) => {
      setSettingsState(loaded);
      setSettingsReady(true);
    });
  }, []);

  useEffect(() => {
    setPositionState((current) => ({ ...current, tokenSymbol: token.symbol }));
  }, [token.symbol]);

  useEffect(() => {
    if (!settingsReady || !displayedWallet) return;
    let cancelled = false;

    const refresh = async () => {
      setPositionLoading(true);
      const response = await getPosition(displayedWallet, token.mint, settingsState);
      if (cancelled) return;
      setPositionLoading(false);
      if (!response.ok) {
        setPositionError(response.error ?? 'Position unavailable');
        return;
      }
      setPositionError(null);
      setPositionState({
        walletSol: response.walletSol ?? 0,
        walletWsol: response.walletWsol ?? 0,
        tokenAmount: response.tokenAmount ?? 0,
        tokenRawAmount: response.tokenRawAmount ?? '0',
        tokenSymbol: token.symbol,
        costBasisSol: pnlLedger?.costBasisSol ?? 0,
        realizedPnlSol: pnlLedger?.realizedPnlSol ?? 0,
        pnlUsd: 0,
        pnlSol: pnlLedger?.realizedPnlSol ?? 0
      });
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [displayedWallet, pnlLedger?.costBasisSol, pnlLedger?.realizedPnlSol, settingsReady, settingsState.rpcMode, settingsState.rpcUrl, settingsState.trenchRpcUrl, token.mint, token.symbol]);

  useEffect(() => {
    setPnlLedger(displayedWallet && token.mint ? loadPnlLedger(displayedWallet, token.mint) : null);
  }, [displayedWallet, token.mint]);

  useEffect(() => {
    if (!settingsReady) return;
    saveSettings(settingsState);
  }, [settingsReady, settingsState]);

  useEffect(() => {
    savePosition(position);
  }, [position]);

  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  useEffect(() => {
    const refresh = () => setToken(readAxiomTokenContext());
    refresh();

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', refresh);
    const interval = window.setInterval(refresh, 2000);

    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', refresh);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!flash) return;
    const timeout = window.setTimeout(() => setFlash(null), 520);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.dragging) return;
      const next = clampPosition({
        x: event.clientX - dragRef.current.dx,
        y: event.clientY - dragRef.current.dy
      });
      setPosition(next);
    };

    const onPointerUp = () => {
      dragRef.current.dragging = false;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!settingsState.hotkeys || !active || isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const buyIndex = ['1', '2', '3', '4'].indexOf(key);
      if (buyIndex >= 0) {
        event.preventDefault();
        void executeTrade('buy', settingsState.buyAmounts[buyIndex]);
      }

      const sellIndex = ['q', 'w', 'e', 'r'].indexOf(key);
      if (sellIndex >= 0) {
        event.preventDefault();
        void executeTrade('sell', settingsState.sellPercents[sellIndex]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, settingsState, token.mint]);

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('button, select, input, .tw-no-drag')) return;

    dragRef.current = {
      dragging: true,
      dx: event.clientX - position.x,
      dy: event.clientY - position.y
    };
  }

  function patchSettings(patch: Partial<TradeSettings>) {
    setSettingsState((current) => ({ ...current, ...patch }));
  }

  async function executeTrade(side: TradeSide, amount: number) {
    if (pendingSide) return;
    setActive(true);
    setPendingSide(side);
    setToast({ kind: 'info', text: side === 'buy' ? 'Buying...' : 'Selling...' });

    try {
      const result = await runTrade(side, amount, token.mint, settingsState, wallet);
      setWallet(result.publicKey);

      setFlash('success');
      setToast({ kind: 'success', text: side === 'buy' ? 'Buy filled' : 'Sell filled', signature: result.response.signature });
      addTradeHistory(setOrders, {
        side,
        mint: token.mint,
        wallet: result.publicKey,
        route: result.prepared.route,
        signature: result.response.signature,
        summary: result.prepared.quoteSummary,
        size: formatTradeValue(side, amount),
        status: 'Sent'
      });
      if (token.mint && result.before?.ok) void refreshPnlAfterTrade(result.publicKey, token.mint, side, result.before, settingsState, setPnlLedger, setPositionState);
    } catch (error) {
      const publicKey = settingsState.signerMode === 'local' ? settingsState.localWalletPublicKey : wallet ?? '';
      addTradeHistory(setOrders, {
        side,
        mint: token.mint,
        wallet: publicKey,
        error: error instanceof Error ? error.message : 'RPC timeout',
        size: formatTradeValue(side, amount),
        status: 'Failed'
      });
      setFlash('error');
      setToast({ kind: 'error', text: error instanceof Error ? error.message : 'RPC timeout' });
    } finally {
      setPendingSide(null);
    }
  }

  if (collapsed) {
    return (
      <button
        className="tw-compact"
        style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
        onClick={() => setCollapsed(false)}
        onFocus={() => setActive(true)}
      >
        <Zap size={15} />
        Trench
      </button>
    );
  }

  return (
    <section
      className={`tw-widget ${flash ? `tw-flash-${flash}` : ''}`}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      onPointerDown={() => setActive(true)}
      onFocus={() => setActive(true)}
    >
      <header className="tw-header" onPointerDown={startDrag}>
        <div className="tw-brand">
          <div className="tw-logo">TR</div>
          <div className="tw-title-wrap">
            <div className="tw-title">Trench</div>
            <div className="tw-mint" title={token.mint ?? 'Mint not found'}>
              {token.mint ? `${shortMint(token.mint)} / ${token.source === 'axiom-url' ? 'URL' : token.source === 'dom' ? 'DOM' : 'NA'}` : 'No mint'}
            </div>
          </div>
          <button className="tw-preset tw-no-drag" type="button">
            P3 <ChevronDown size={12} />
          </button>
        </div>

        <nav className="tw-header-actions tw-no-drag" aria-label="Trench actions">
          {isPublicRpc(settingsState) ? <span className="tw-rpc-warn" title="Public RPC — rate limited, consider adding a private key in Options">PUB</span> : null}
          <IconButton label="Orders"><History size={14} /></IconButton>
          <IconButton label={walletButtonLabel(settingsState, wallet)} onClick={() => connectBrowserWallet(settingsState, setWallet, setToast)}>
            <Wallet size={14} />
          </IconButton>
          <IconButton label="Calculator"><Calculator size={14} /></IconButton>
          <IconButton label="Edit preset"><Edit3 size={14} /></IconButton>
          <IconButton label="Settings" active={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={14} />
          </IconButton>
          <IconButton label="Collapse" onClick={() => setCollapsed(true)}><ChevronUp size={14} /></IconButton>
        </nav>
      </header>

      <main className="tw-body">
        {settingsOpen ? (
          <SettingsPanel
            settings={settingsState}
            onChange={patchSettings}
            onClearHistory={() => {
              localStorage.removeItem(TRADE_HISTORY_KEY);
              setOrders([]);
              setToast({ kind: 'info', text: 'Trade history cleared' });
            }}
            onClearPnl={() => {
              localStorage.removeItem(PNL_LEDGER_KEY);
              setPnlLedger(null);
              setToast({ kind: 'info', text: 'Local PnL cleared' });
            }}
          />
        ) : null}

        <TradeSection
          side="buy"
          title="Buy"
          meta={<><SolanaMark /> {positionLoading ? '...' : positionState.walletSol.toFixed(4)} SOL</>}
          buttons={settingsState.buyAmounts}
          selected={settingsState.selectedBuyAmount}
          pending={pendingSide === 'buy'}
          settings={settingsState}
          onSelect={(value) => patchSettings({ selectedBuyAmount: value })}
          onExecute={(value) => executeTrade('buy', value)}
        />

        <div className="tw-divider" />

        <TradeSection
          side="sell"
          title="Sell"
          meta={
            <span className="tw-position-meta">
              {positionState.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {positionState.tokenSymbol} /{' '}
              <span className={positionState.pnlSol > 0 ? 'tw-positive' : positionState.pnlSol < 0 ? 'tw-negative' : 'tw-muted'}>
                {positionError ? positionError : `RPNL ${positionState.realizedPnlSol.toFixed(4)} SOL`}
              </span>
            </span>
          }
          buttons={settingsState.sellPercents}
          selected={settingsState.selectedSellPercent}
          pending={pendingSide === 'sell'}
          settings={settingsState}
          onSelect={(value) => patchSettings({ selectedSellPercent: value })}
          onExecute={(value) => executeTrade('sell', value)}
        />

        <section className="tw-orders">
          <button className="tw-orders-head" type="button" onClick={() => setOrdersOpen((value) => !value)}>
            <span>Orders ({orders.length})</span>
            {ordersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {ordersOpen ? (
            <div className="tw-orders-list">
              {orders.length ? (
                orders.map((order) => (
                  <div className="tw-order-row" key={order.id}>
                    <span className={`tw-side-badge tw-side-${order.side}`}>{capitalize(order.side)}</span>
                    <span className="tw-order-condition" title={order.error ?? order.summary ?? order.mint ?? ''}>{formatOrderSummary(order)}</span>
                    <span className="tw-order-size">{order.size}</span>
                    <span className={`tw-status tw-status-${order.status.toLowerCase()}`}>{order.status}</span>
                    {order.signature ? (
                      <a className="tw-cancel" href={`https://solscan.io/tx/${order.signature}`} target="_blank" rel="noreferrer">View</a>
                    ) : (
                      <span className="tw-cancel tw-disabled">{formatTime(order.createdAt)}</span>
                    )}
                  </div>
                ))
              ) : (
                <div className="tw-empty">No active orders</div>
              )}
            </div>
          ) : null}
        </section>
      </main>

      {toast ? <Toast toast={toast} /> : null}
    </section>
  );
}

function TradeSection(props: {
  side: TradeSide;
  title: string;
  meta: React.ReactNode;
  buttons: number[];
  selected: number;
  pending: boolean;
  settings: TradeSettings;
  onSelect: (value: number) => void;
  onExecute: (value: number) => void;
}) {
  const { side, title, meta, buttons, selected, pending, settings, onSelect, onExecute } = props;

  return (
    <section className={`tw-trade tw-trade-${side}`}>
      <div className="tw-section-head">
        <span className="tw-section-label">{title}</span>
        <span className="tw-section-meta">{meta}</span>
      </div>

      <div className="tw-quick-grid">
        {buttons.map((value) => (
          <button
            className={`tw-quick tw-quick-${side} ${value === selected ? 'tw-selected' : ''}`}
            type="button"
            key={value}
            onClick={() => {
              onSelect(value);
              onExecute(value);
            }}
            disabled={pending}
          >
            {pending && value === selected ? <Loader2 className="tw-spin" size={13} /> : null}
            {pending && value === selected ? (side === 'buy' ? 'Buying...' : 'Selling...') : formatTradeValue(side, value)}
          </button>
        ))}
      </div>

      <div className="tw-param-row">
        <ParamChip title="Signer">{settings.signerMode === 'local' ? 'HOT' : 'WLT'}</ParamChip>
        <ParamChip title="RPC mode">{settings.rpcMode === 'trench' ? 'TRN' : 'RPC'}</ParamChip>
        <ParamChip title="Send mode">{settings.sendMode === 'jito' ? 'JITO' : 'STD'}</ParamChip>
        <ParamChip title="Slippage">SLP {settings.slippage}%</ParamChip>
        <ParamChip title="Priority fee">{settings.autoFee ? `AUTO·${settings.autoFeeLevel.slice(0,1).toUpperCase()}` : `FEE·${settings.priorityFee}`}</ParamChip>
        <ParamChip title="Protection">{settings.protection ? 'PROT' : 'OPEN'}</ParamChip>
      </div>
    </section>
  );
}

function SettingsPanel(props: { settings: TradeSettings; onChange: (patch: Partial<TradeSettings>) => void; onClearHistory: () => void; onClearPnl: () => void }) {
  const { settings, onChange, onClearHistory, onClearPnl } = props;

  return (
    <section className="tw-settings-panel">
      <div className="tw-settings-title">Execution preset</div>
      <div className="tw-settings-grid">
        <label>
          <span>Buy amounts</span>
          <input value={settings.buyAmounts.join(' ')} onChange={(event) => onChange({ buyAmounts: parseNumberList(event.target.value, defaultSettings.buyAmounts) })} />
        </label>
        <label>
          <span>Sell %</span>
          <input value={settings.sellPercents.join(' ')} onChange={(event) => onChange({ sellPercents: parseNumberList(event.target.value, defaultSettings.sellPercents) })} />
        </label>
        <label>
          <span>Slippage</span>
          <input type="number" value={settings.slippage} onChange={(event) => onChange({ slippage: Number(event.target.value) })} />
        </label>
        <label>
          <span>Priority</span>
          <input type="number" step="0.001" value={settings.priorityFee} disabled={settings.autoFee} onChange={(event) => onChange({ priorityFee: Number(event.target.value) })} />
        </label>
        <label>
          <span>Jito tip</span>
          <input type="number" step="0.001" value={settings.jitoTip} disabled={settings.autoFee} onChange={(event) => onChange({ jitoTip: Number(event.target.value) })} />
        </label>
        <label>
          <span>Auto level</span>
          <select value={settings.autoFeeLevel} disabled={!settings.autoFee} onChange={(event) => onChange({ autoFeeLevel: event.target.value as TradeSettings['autoFeeLevel'] })}>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
            <option value="turbo">Turbo</option>
          </select>
        </label>
        <label>
          <span>Auto max</span>
          <input type="number" step="0.0001" value={settings.autoFeeMax} disabled={!settings.autoFee} onChange={(event) => onChange({ autoFeeMax: Number(event.target.value) })} />
        </label>
        <label>
          <span>Signer</span>
          <select value={settings.signerMode} onChange={(event) => onChange({ signerMode: event.target.value as TradeSettings['signerMode'] })}>
            <option value="wallet">Browser wallet</option>
            <option value="local">Local hot wallet</option>
          </select>
        </label>
        <label>
          <span>Local pubkey</span>
          <input value={settings.localWalletPublicKey} readOnly />
        </label>
        <label>
          <span>RPC mode</span>
          <select value={settings.rpcMode} onChange={(event) => onChange({ rpcMode: event.target.value as TradeSettings['rpcMode'] })}>
            <option value="custom">Custom RPC, 0%</option>
            <option value="trench">Trench RPC, 0.1%</option>
          </select>
        </label>
        <label>
          <span>RPC URL</span>
          <input value={settings.rpcUrl} onChange={(event) => onChange({ rpcUrl: event.target.value })} />
        </label>
        <label>
          <span>Trench router</span>
          <input value={settings.trenchRpcUrl} onChange={(event) => onChange({ trenchRpcUrl: event.target.value })} />
        </label>
        <label>
          <span>Fee recipient</span>
          <input value={settings.trenchFeeRecipient} onChange={(event) => onChange({ trenchFeeRecipient: event.target.value })} />
        </label>
        <label>
          <span>Send mode</span>
          <select value={settings.sendMode} onChange={(event) => onChange({ sendMode: event.target.value as TradeSettings['sendMode'] })}>
            <option value="rpc">RPC preflight</option>
            <option value="jito">Jito low latency</option>
          </select>
        </label>
        <label>
          <span>Jito endpoint</span>
          <input value={settings.jitoEndpoint} onChange={(event) => onChange({ jitoEndpoint: event.target.value })} />
        </label>
        <label>
          <span>Engine</span>
          <select value={settings.executionMode} onChange={(event) => onChange({ executionMode: event.target.value as TradeSettings['executionMode'] })}>
            <option value="jupiter">Jupiter</option>
            <option value="pump">Pump</option>
            <option value="auto">Auto</option>
          </select>
        </label>
        <label className="tw-toggle-row">
          <span>Auto fee</span>
          <input type="checkbox" checked={settings.autoFee} onChange={(event) => onChange({ autoFee: event.target.checked })} />
        </label>
        <label className="tw-toggle-row">
          <span>Protection</span>
          <input type="checkbox" checked={settings.protection} onChange={(event) => onChange({ protection: event.target.checked })} />
        </label>
        <label className="tw-toggle-row">
          <span>Confirm</span>
          <input type="checkbox" checked={settings.confirmation} onChange={(event) => onChange({ confirmation: event.target.checked })} />
        </label>
        <label className="tw-toggle-row">
          <span>Hotkeys</span>
          <input type="checkbox" checked={settings.hotkeys} onChange={(event) => onChange({ hotkeys: event.target.checked })} />
        </label>
        <label className="tw-toggle-row">
          <span>Jito bundleOnly</span>
          <input type="checkbox" checked={settings.jitoBundleOnly} onChange={(event) => onChange({ jitoBundleOnly: event.target.checked })} />
        </label>
        <div className="tw-settings-actions">
          <button type="button" onClick={onClearHistory}>Clear history</button>
          <button type="button" onClick={onClearPnl}>Clear PnL</button>
        </div>
      </div>
    </section>
  );
}

function IconButton(props: { label: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button className={`tw-icon-btn ${props.active ? 'tw-icon-active' : ''}`} type="button" title={props.label} aria-label={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function ParamChip(props: { title: string; children: React.ReactNode }) {
  return (
    <button className="tw-param-chip" type="button" title={props.title}>
      {props.children}
    </button>
  );
}

function Toast(props: { toast: { kind: ToastKind; text: string; signature?: string } }) {
  const { toast } = props;
  const href = toast.signature && !toast.signature.startsWith('stub-') ? `https://solscan.io/tx/${toast.signature}` : undefined;

  return (
    <div className={`tw-toast tw-toast-${toast.kind}`}>
      {toast.kind === 'success' ? <CheckCircle2 size={14} /> : toast.kind === 'error' ? <X size={14} /> : <Loader2 className="tw-spin" size={14} />}
      <span>{toast.text}</span>
      {toast.signature ? (
        href ? (
          <a href={href} target="_blank" rel="noreferrer" title={toast.signature}><ExternalLink size={13} /></a>
        ) : (
          <span className="tw-signature" title={toast.signature}>tx</span>
        )
      ) : null}
    </div>
  );
}

function SolanaMark() {
  return <span className="tw-solana" aria-hidden="true" />;
}

async function runTrade(side: TradeSide, amount: number, mint: string | null, settings: TradeSettings, currentWallet: string | null) {
  const publicKey = settings.signerMode === 'local' ? settings.localWalletPublicKey : currentWallet ?? (await walletRequest('TRENCH_WALLET_CONNECT')).publicKey;
  if (!publicKey) throw new Error('Wallet not connected');

  const before = mint ? await getPosition(publicKey, mint, settings) : null;
  const prepared = await prepareTradeMessage(side, amount, mint, publicKey, settings);
  if (!prepared.ok || !prepared.swapTransaction) throw new Error(prepared.error ?? 'Tx prepare failed');

  const response = settings.signerMode === 'local'
    ? await signAndSendLocal(prepared.swapTransaction, settings)
    : await signAndSendBrowserWallet(prepared.swapTransaction, settings);
  if (!response.ok) throw new Error(response.error ?? 'RPC send failed');

  return { publicKey, before, prepared, response };
}

function initPulseQuickBuy() {
  installPulseStyle();
  refreshPulseQuickBuyButtons();

  const observer = new MutationObserver(() => refreshPulseQuickBuyButtons());
  observer.observe(document.body, { childList: true, subtree: true });

  const intervalId = window.setInterval(refreshPulseQuickBuyButtons, 2000);

  function cleanup() {
    observer.disconnect();
    window.clearInterval(intervalId);
    window.removeEventListener('popstate', onPopState);
  }

  function onPopState() {
    cleanup();
    initPulseQuickBuy();
  }

  window.addEventListener('popstate', onPopState);
}

function refreshPulseQuickBuyButtons() {
  if (!isPulsePage()) return;

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/meme/"]'))) {
    const mint = parseAxiomMintFromUrl(link.href);
    if (!mint) continue;

    const card = findPulseCard(link);
    if (!card || card.querySelector(`.${PULSE_BUTTON_CLASS}[data-mint="${mint}"]`)) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = PULSE_BUTTON_CLASS;
    button.dataset.mint = mint;
    button.textContent = 'Quick buy';
    button.title = `Trench quick buy ${shortMint(mint)}`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void pulseQuickBuy(button, mint);
    });

    const target = findPulseButtonTarget(card) ?? card;
    target.appendChild(button);
  }
}

async function pulseQuickBuy(button: HTMLButtonElement, mint: string) {
  if (button.disabled) return;
  button.disabled = true;
  button.dataset.state = 'pending';
  button.textContent = 'Buying...';

  try {
    const settings = await loadExtensionSettings();
    const amount = settings.selectedBuyAmount || settings.buyAmounts[0] || defaultSettings.selectedBuyAmount;
    const result = await runTrade('buy', amount, mint, settings, null);
    addTradeHistoryDirect({
      side: 'buy',
      mint,
      wallet: result.publicKey,
      route: result.prepared.route,
      signature: result.response.signature,
      summary: result.prepared.quoteSummary,
      size: formatTradeValue('buy', amount),
      status: 'Sent'
    });
    button.dataset.state = 'success';
    button.textContent = 'Bought';
    window.setTimeout(() => {
      button.disabled = false;
      button.dataset.state = '';
      button.textContent = 'Quick buy';
    }, 2600);
  } catch (error) {
    const settings = await loadExtensionSettings().catch(() => defaultSettings);
    addTradeHistoryDirect({
      side: 'buy',
      mint,
      wallet: settings.signerMode === 'local' ? settings.localWalletPublicKey : '',
      error: error instanceof Error ? error.message : 'Quick buy failed',
      size: formatTradeValue('buy', settings.selectedBuyAmount || settings.buyAmounts[0] || defaultSettings.selectedBuyAmount),
      status: 'Failed'
    });
    button.dataset.state = 'error';
    button.textContent = error instanceof Error ? error.message.slice(0, 22) : 'Failed';
    window.setTimeout(() => {
      button.disabled = false;
      button.dataset.state = '';
      button.textContent = 'Quick buy';
    }, 3200);
  }
}

function installPulseStyle() {
  if (document.getElementById(PULSE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = PULSE_STYLE_ID;
  style.textContent = `
    .${PULSE_BUTTON_CLASS} {
      display: inline-flex;
      height: 24px;
      align-items: center;
      justify-content: center;
      margin: 3px 3px 0 0;
      padding: 0 8px;
      border: 1px solid #18281e;
      border-radius: 4px;
      background: #0d0d11;
      color: #14f195;
      cursor: pointer;
      font: 700 9px/1 "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .${PULSE_BUTTON_CLASS}:hover { border-color: rgba(20, 241, 149, 0.45); background: rgba(20, 241, 149, 0.06); color: #5fffc0; }
    .${PULSE_BUTTON_CLASS}:disabled { cursor: wait; opacity: 0.5; }
    .${PULSE_BUTTON_CLASS}[data-state="success"] { border-color: rgba(20, 241, 149, 0.5); color: #14f195; }
    .${PULSE_BUTTON_CLASS}[data-state="error"] { border-color: #281820; color: #ff607a; }
  `;
  document.head.appendChild(style);
}

function isPulsePage() {
  return window.location.hostname.endsWith('axiom.trade') && window.location.pathname.startsWith('/pulse');
}

function findPulseCard(link: HTMLElement) {
  return link.closest<HTMLElement>('article, li, tr, [role="row"], [data-testid*="card"], [class*="card"], [class*="Card"], [class*="token"], [class*="Token"]') ?? link.parentElement;
}

function findPulseButtonTarget(card: HTMLElement) {
  return card.querySelector<HTMLElement>('[class*="action"], [class*="Action"], [class*="button"], [class*="Button"]');
}

function emptyPosition(symbol: string): PositionState {
  return { walletSol: 0, walletWsol: 0, tokenAmount: 0, tokenRawAmount: '0', tokenSymbol: symbol, costBasisSol: 0, realizedPnlSol: 0, pnlUsd: 0, pnlSol: 0 };
}

async function refreshPnlAfterTrade(
  wallet: string,
  mint: string,
  side: TradeSide,
  before: PositionResponse,
  settings: TradeSettings,
  setPnlLedger: (ledger: PnlLedger) => void,
  setPositionState: React.Dispatch<React.SetStateAction<PositionState>>
) {
  await delay(5000);
  const after = await getPosition(wallet, mint, settings);
  if (!after.ok) return;

  const next = updatePnlLedger(wallet, mint, side, before, after);
  setPnlLedger(next);
  setPositionState((current) => ({
    ...current,
    walletSol: after.walletSol ?? current.walletSol,
    walletWsol: after.walletWsol ?? current.walletWsol,
    tokenAmount: after.tokenAmount ?? current.tokenAmount,
    tokenRawAmount: after.tokenRawAmount ?? current.tokenRawAmount,
    costBasisSol: next.costBasisSol,
    realizedPnlSol: next.realizedPnlSol,
    pnlSol: next.realizedPnlSol
  }));
}

function updatePnlLedger(wallet: string, mint: string, side: TradeSide, before: PositionResponse, after: PositionResponse) {
  const current = loadPnlLedger(wallet, mint) ?? { rawTokenAmount: '0', costBasisSol: 0, realizedPnlSol: 0, updatedAt: Date.now() };
  const beforeRaw = BigInt(before.tokenRawAmount ?? '0');
  const afterRaw = BigInt(after.tokenRawAmount ?? '0');
  const tokenDelta = afterRaw - beforeRaw;
  const solBefore = (before.walletSol ?? 0) + (before.walletWsol ?? 0);
  const solAfter = (after.walletSol ?? 0) + (after.walletWsol ?? 0);
  const solDelta = solAfter - solBefore;

  let rawTokenAmount = BigInt(current.rawTokenAmount);
  let costBasisSol = current.costBasisSol;
  let realizedPnlSol = current.realizedPnlSol;

  if (side === 'buy' && tokenDelta > 0n && solDelta < 0) {
    rawTokenAmount += tokenDelta;
    costBasisSol += Math.abs(solDelta);
  }

  if (side === 'sell' && tokenDelta < 0n && solDelta > 0 && rawTokenAmount > 0n && costBasisSol > 0) {
    const soldRaw = minBigInt(-tokenDelta, rawTokenAmount);
    const soldRatio = Number((soldRaw * 1_000_000n) / rawTokenAmount) / 1_000_000;
    const removedCostBasis = costBasisSol * soldRatio;
    rawTokenAmount -= soldRaw;
    costBasisSol = Math.max(0, costBasisSol - removedCostBasis);
    realizedPnlSol += solDelta - removedCostBasis;
  }

  const next: PnlLedger = {
    rawTokenAmount: rawTokenAmount.toString(),
    costBasisSol,
    realizedPnlSol,
    updatedAt: Date.now()
  };
  savePnlLedger(wallet, mint, next);
  return next;
}

function loadPnlLedger(wallet: string, mint: string): PnlLedger | null {
  const store = loadPnlStore();
  return store[pnlKey(wallet, mint)] ?? null;
}

function savePnlLedger(wallet: string, mint: string, ledger: PnlLedger) {
  const store = loadPnlStore();
  store[pnlKey(wallet, mint)] = ledger;
  localStorage.setItem(PNL_LEDGER_KEY, JSON.stringify(store));
}

function loadPnlStore(): Record<string, PnlLedger> {
  try {
    return JSON.parse(localStorage.getItem(PNL_LEDGER_KEY) ?? '{}') as Record<string, PnlLedger>;
  } catch {
    return {};
  }
}

function pnlKey(wallet: string, mint: string) {
  return `${wallet}:${mint}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function minBigInt(a: bigint, b: bigint) {
  return a < b ? a : b;
}

function addTradeHistory(setOrders: React.Dispatch<React.SetStateAction<TradeOrder[]>>, order: Omit<TradeOrder, 'id' | 'createdAt'>) {
  setOrders((current) => {
    const next = [{ ...order, id: `tr-${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: Date.now() }, ...current].slice(0, 50);
    localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(next));
    return next;
  });
}

function addTradeHistoryDirect(order: Omit<TradeOrder, 'id' | 'createdAt'>) {
  const current = loadTradeHistory();
  const next = [{ ...order, id: `tr-${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: Date.now() }, ...current].slice(0, 50);
  localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(next));
}

function loadTradeHistory(): TradeOrder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_HISTORY_KEY) ?? '[]') as TradeOrder[];
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function formatOrderSummary(order: TradeOrder) {
  if (order.error) return order.error;
  if (order.summary) return order.summary;
  const route = order.route ? order.route.toUpperCase() : 'TX';
  return order.mint ? `${route} ${shortMint(order.mint)}` : route;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function walletButtonLabel(settings: TradeSettings, wallet: string | null) {
  if (settings.signerMode === 'local') return settings.localWalletPublicKey ? `Hot wallet ${shortMint(settings.localWalletPublicKey)}` : 'Hot wallet not set';
  return wallet ? `Wallet ${shortMint(wallet)}` : 'Connect wallet';
}

function connectBrowserWallet(
  settings: TradeSettings,
  setWallet: (wallet: string) => void,
  setToast: (toast: { kind: ToastKind; text: string; signature?: string } | null) => void
) {
  if (settings.signerMode === 'local') {
    setToast({ kind: settings.localWalletPublicKey ? 'info' : 'error', text: settings.localWalletPublicKey ? 'Using local hot wallet' : 'Import hot wallet in options' });
    return;
  }

  walletRequest('TRENCH_WALLET_CONNECT')
    .then((value) => value.publicKey && setWallet(value.publicKey))
    .catch((error: unknown) => setToast({ kind: 'error', text: error instanceof Error ? error.message : 'Wallet error' }));
}

function prepareTradeMessage(side: TradeSide, amount: number, mint: string | null, wallet: string, settings: TradeSettings): Promise<TradeResponse> {
  return new Promise((resolve) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;
    if (!sendMessage) {
      window.setTimeout(() => resolve({ ok: false, error: 'Extension runtime unavailable' }), 200);
      return;
    }

    sendMessage({ type: 'TRENCH_PREPARE_TRADE', side, amount, mint, wallet, settings }, resolve);
  });
}

function getPosition(wallet: string, mint: string | null, settings: TradeSettings): Promise<PositionResponse> {
  return new Promise((resolve) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;
    if (!sendMessage) {
      window.setTimeout(() => resolve({ ok: false, error: 'Extension runtime unavailable' }), 200);
      return;
    }

    sendMessage({ type: 'TRENCH_GET_POSITION', wallet, mint, settings }, resolve);
  });
}

async function signAndSendBrowserWallet(transaction: string, settings: TradeSettings): Promise<TradeResponse> {
  const signed = await walletRequest('TRENCH_WALLET_SIGN_TRANSACTION', transaction);
  if (!signed.signedTransaction) throw new Error('Wallet did not sign transaction');
  return sendSignedTransaction(signed.signedTransaction, settings);
}

function sendSignedTransaction(signedTransaction: string, settings: TradeSettings): Promise<TradeResponse> {
  return new Promise((resolve) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;
    if (!sendMessage) {
      window.setTimeout(() => resolve({ ok: false, error: 'Extension runtime unavailable' }), 200);
      return;
    }

    sendMessage({ type: 'TRENCH_SEND_SIGNED_TRANSACTION', signedTransaction, settings }, resolve);
  });
}

function signAndSendLocal(transaction: string, settings: TradeSettings): Promise<TradeResponse> {
  return new Promise((resolve) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;
    if (!sendMessage) {
      window.setTimeout(() => resolve({ ok: false, error: 'Extension runtime unavailable' }), 200);
      return;
    }

    sendMessage({ type: 'TRENCH_SIGN_AND_SEND_LOCAL', transaction, settings }, resolve);
  });
}

function walletRequest(type: WalletBridgeRequest['type'], transaction?: string): Promise<WalletBridgeResponse> {
  const id = `tw-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Wallet timeout'));
    }, 60_000);

    function onMessage(event: MessageEvent<WalletBridgeResponse>) {
      if (event.source !== window) return;
      const response = event.data;
      if (response?.type !== 'TRENCH_WALLET_RESPONSE' || response.id !== id) return;

      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);

      if (!response.ok) reject(new Error(response.error ?? 'Wallet error'));
      else resolve(response);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ id, type, transaction }, window.location.origin);
  });
}

function injectWalletBridge() {
  const src = window.chrome?.runtime?.getURL?.('injected.js');
  if (!src || document.querySelector(`script[src="${src}"]`)) return;

  const script = document.createElement('script');
  script.src = src;
  script.type = 'module';
  script.dataset.trench = 'wallet-bridge';
  (document.head || document.documentElement).appendChild(script);
}

function clampPosition(position: { x: number; y: number }) {
  const maxX = Math.max(8, window.innerWidth - 344);
  const maxY = Math.max(8, window.innerHeight - 80);

  return {
    x: Math.min(Math.max(8, position.x), maxX),
    y: Math.min(Math.max(8, position.y), maxY)
  };
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function formatTradeValue(side: TradeSide, value: number) {
  return side === 'sell' ? `${value}%` : String(value);
}

function isPublicRpc(settings: TradeSettings) {
  const url = settings.rpcMode === 'trench' ? settings.trenchRpcUrl : settings.rpcUrl;
  return url.includes('api.mainnet-beta.solana.com');
}

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseNumberList(value: string, fallback: number[]) {
  const parsed = value
    .split(/[\s,]+/)
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0)
    .slice(0, 4);

  return parsed.length ? parsed : fallback;
}

mount();
