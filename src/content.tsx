import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  GripHorizontal,
  History,
  Loader2,
  Settings,
  ShieldCheck,
  Target,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import { readAxiomTokenContext } from './axiom';
import {
  defaultSettings,
  loadCollapsed,
  loadPosition,
  loadSettings,
  saveCollapsed,
  savePosition,
  saveSettings
} from './storage';
import type { PositionState, ToastKind, TokenContext, TradeOrder, TradeResponse, TradeSettings, TradeSide } from './types';
import type { WalletBridgeRequest, WalletBridgeResponse } from './types';
import styles from './styles.css?inline';

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        getURL?: (path: string) => string;
        sendMessage?: (message: unknown, callback: (response: TradeResponse) => void) => void;
      };
    };
  }
}

const ROOT_ID = 'tradewiz-shadow-root';

const sampleOrders: TradeOrder[] = [
  { id: 'o-1', side: 'sell', condition: 'Price -25% / $0.00339', size: '50%', status: 'Active' },
  { id: 'o-2', side: 'sell', condition: 'Price -25% / $0.00339', size: '30%', status: 'Active' },
  { id: 'o-3', side: 'buy', condition: 'Price +25% / $0.00339', size: '5.5 SOL', status: 'Failed' },
  { id: 'o-4', side: 'buy', condition: 'Price +25% / $0.00339', size: '5.5 SOL', status: 'Canceled' }
];

function mount() {
  if (document.getElementById(ROOT_ID)) return;
  injectWalletBridge();

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  const rootNode = document.createElement('div');
  shadow.appendChild(rootNode);

  createRoot(rootNode).render(<TradeWizOverlay />);
}

function TradeWizOverlay() {
  const [settingsState, setSettingsState] = useState<TradeSettings>(() => loadSettings());
  const [position, setPosition] = useState(() => clampPosition(loadPosition()));
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [token, setToken] = useState<TokenContext>(() => readAxiomTokenContext());
  const [orders, setOrders] = useState<TradeOrder[]>(sampleOrders);
  const [pendingSide, setPendingSide] = useState<TradeSide | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: ToastKind; text: string; signature?: string } | null>(null);
  const [flash, setFlash] = useState<ToastKind | null>(null);
  const [active, setActive] = useState(false);
  const dragRef = useRef({ dragging: false, dx: 0, dy: 0 });

  const positionState: PositionState = useMemo(
    () => ({
      walletSol: 256.55,
      tokenAmount: 15698.65,
      tokenSymbol: token.symbol,
      pnlUsd: 3266,
      pnlSol: 2.55
    }),
    [token.symbol]
  );

  useEffect(() => {
    saveSettings(settingsState);
  }, [settingsState]);

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
      const publicKey = wallet ?? (await walletRequest('TRADEWIZ_WALLET_CONNECT')).publicKey;
      if (!publicKey) throw new Error('Wallet not connected');
      setWallet(publicKey);

      const prepared = await prepareTradeMessage(side, amount, token.mint, publicKey, settingsState);
      if (!prepared.ok || !prepared.swapTransaction) throw new Error(prepared.error ?? 'Tx prepare failed');

      const signed = await walletRequest('TRADEWIZ_WALLET_SIGN_TRANSACTION', prepared.swapTransaction);
      if (!signed.signedTransaction) throw new Error('Wallet did not sign transaction');

      const response = await sendSignedTransaction(signed.signedTransaction, settingsState.rpcUrl);
      if (!response.ok) throw new Error(response.error ?? 'RPC send failed');

      setFlash('success');
      setToast({ kind: 'success', text: side === 'buy' ? 'Buy filled' : 'Sell filled', signature: response.signature });
    } catch (error) {
      setFlash('error');
      setToast({ kind: 'error', text: error instanceof Error ? error.message : 'RPC timeout' });
    } finally {
      setPendingSide(null);
    }
  }

  function cancelOrder(orderId: string) {
    setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, status: 'Canceled' } : order)));
    setToast({ kind: 'info', text: 'Order canceled' });
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
        TradeWiz
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
          <div className="tw-logo">TW</div>
          <div className="tw-title-wrap">
            <div className="tw-title">TradeWiz</div>
            <div className="tw-mint" title={token.mint ?? 'Mint not found'}>
              {wallet ? shortMint(wallet) : token.mint ? shortMint(token.mint) : 'No mint'}
            </div>
          </div>
          <button className="tw-preset tw-no-drag" type="button">
            P3 <ChevronDown size={12} />
          </button>
        </div>

        <nav className="tw-header-actions tw-no-drag" aria-label="TradeWiz actions">
          <IconButton label="Orders"><History size={14} /></IconButton>
          <IconButton label={wallet ? `Wallet ${shortMint(wallet)}` : 'Connect wallet'} onClick={() => walletRequest('TRADEWIZ_WALLET_CONNECT').then((value) => value.publicKey && setWallet(value.publicKey)).catch((error: unknown) => setToast({ kind: 'error', text: error instanceof Error ? error.message : 'Wallet error' }))}>
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
        {settingsOpen ? <SettingsPanel settings={settingsState} onChange={patchSettings} /> : null}

        <TradeSection
          side="buy"
          title="Buy"
          meta={<><SolanaMark /> {positionState.walletSol.toFixed(2)} SOL</>}
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
                ${positionState.pnlUsd.toLocaleString()} PNL {positionState.pnlSol.toFixed(2)} SOL
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
                    <span className="tw-order-condition">{order.condition}</span>
                    <span className="tw-order-size">{order.size}</span>
                    <span className={`tw-status tw-status-${order.status.toLowerCase()}`}>{order.status}</span>
                    {order.status === 'Active' ? (
                      <button className="tw-cancel" type="button" onClick={() => cancelOrder(order.id)}>Cancel</button>
                    ) : (
                      <span className="tw-cancel tw-disabled">-</span>
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
        <span>{title}</span>
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
        <ParamChip title="Slippage"><Target size={12} /> {settings.slippage}%</ParamChip>
        <ParamChip title="Priority fee"><Zap size={12} /> {settings.priorityFee}</ParamChip>
        <ParamChip title="Jito tip"><GripHorizontal size={12} /> {settings.jitoTip}</ParamChip>
        <ParamChip title="Protection"><ShieldCheck size={12} /> {settings.protection ? 'On' : 'Off'}</ParamChip>
      </div>
    </section>
  );
}

function SettingsPanel(props: { settings: TradeSettings; onChange: (patch: Partial<TradeSettings>) => void }) {
  const { settings, onChange } = props;

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
          <input type="number" step="0.001" value={settings.priorityFee} onChange={(event) => onChange({ priorityFee: Number(event.target.value) })} />
        </label>
        <label>
          <span>Jito tip</span>
          <input type="number" step="0.001" value={settings.jitoTip} onChange={(event) => onChange({ jitoTip: Number(event.target.value) })} />
        </label>
        <label>
          <span>RPC URL</span>
          <input value={settings.rpcUrl} onChange={(event) => onChange({ rpcUrl: event.target.value })} />
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

function prepareTradeMessage(side: TradeSide, amount: number, mint: string | null, wallet: string, settings: TradeSettings): Promise<TradeResponse> {
  return new Promise((resolve) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;
    if (!sendMessage) {
      window.setTimeout(() => resolve({ ok: false, error: 'Extension runtime unavailable' }), 200);
      return;
    }

    sendMessage({ type: 'TRADEWIZ_PREPARE_TRADE', side, amount, mint, wallet, settings }, resolve);
  });
}

function sendSignedTransaction(signedTransaction: string, rpcUrl: string): Promise<TradeResponse> {
  return new Promise((resolve) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;
    if (!sendMessage) {
      window.setTimeout(() => resolve({ ok: false, error: 'Extension runtime unavailable' }), 200);
      return;
    }

    sendMessage({ type: 'TRADEWIZ_SEND_SIGNED_TRANSACTION', signedTransaction, rpcUrl }, resolve);
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
      if (response?.type !== 'TRADEWIZ_WALLET_RESPONSE' || response.id !== id) return;

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
  script.dataset.tradewiz = 'wallet-bridge';
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
