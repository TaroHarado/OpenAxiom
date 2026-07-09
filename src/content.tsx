import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Edit3,
  ExternalLink,
  Loader2,
  Percent,
  Settings,
  Shield,
  ShieldOff,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import { parseAxiomMintFromUrl, readAxiomTokenContext } from './axiom';
import { isGmgnRobinhood, readGmgnTokenContext } from './gmgn';
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
import type { EvmTradeResponse, EvmWalletResponse, PositionResponse, PositionState, ToastKind, TokenContext, TradeOrder, TradeResponse, TradeSettings, TradeSide } from './types';
import type { WalletBridgeRequest, WalletBridgeResponse } from './types';
import styles from './styles.css?inline';

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        getURL?: (path: string) => string;
        sendMessage?: (message: unknown, callback?: (response: TradeResponse | PositionResponse) => void) => void;
      };
    };
  }
}

const ROOT_ID = 'trench-shadow-root';
const PULSE_STYLE_ID = 'trench-pulse-style';
const PULSE_BUTTON_CLASS = 'trench-pulse-buy';
const GMGN_STYLE_ID = 'trench-gmgn-style';
const GMGN_BUTTON_CLASS = 'trench-gmgn-buy';
const GMGN_CARD_FLAG = 'data-trench-gmgn';
const EVM_ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;
const PNL_LEDGER_KEY = 'trench.pnl.v1';
const EVM_PNL_LEDGER_KEY = 'trench.evmPnl.v1';
const TRADE_HISTORY_KEY = 'trench.tradeHistory.v1';
const RH_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const RH_USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

type PnlLedger = {
  rawTokenAmount: string;
  costBasisSol: number;
  realizedPnlSol: number;
  updatedAt: number;
};

type EvmPnlLedger = {
  rawTokenAmount: string;
  costBasisUsdg: number;
  realizedPnlUsdg: number;
  updatedAt: number;
};

type EvmBalancePair = { token: bigint; usdg: bigint };

function mount() {
  if (document.getElementById(ROOT_ID)) return;
  console.info('[Trench] content script mounted', window.location.href);
  injectWalletBridge();
  initPulseQuickBuy();
  initGmgnQuickBuy();

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
  const [editAmounts, setEditAmounts] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [token, setToken] = useState<TokenContext>(() => isGmgnRobinhood() ? readGmgnTokenContext() : readAxiomTokenContext());
  const [orders, setOrders] = useState<TradeOrder[]>(() => loadTradeHistory());
  const [pendingSide, setPendingSide] = useState<TradeSide | null>(null);
  const [confirmPending, setConfirmPending] = useState<{ side: TradeSide; amount: number } | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [evmWallet, setEvmWallet] = useState<{ hasWallet: boolean; unlocked: boolean; address?: string }>({ hasWallet: false, unlocked: false });
  const [evmEthBalance, setEvmEthBalance] = useState<number>(0);
  const [evmUsdgBalance, setEvmUsdgBalance] = useState<number>(0);
  const [positionState, setPositionState] = useState<PositionState>(() => emptyPosition((isGmgnRobinhood() ? readGmgnTokenContext() : readAxiomTokenContext()).symbol));
  const [pnlLedger, setPnlLedger] = useState<PnlLedger | null>(null);
  const [evmPnl, setEvmPnl] = useState<EvmPnlLedger | null>(null);
  const [evmTokenAmount, setEvmTokenAmount] = useState(0);
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
    const refreshEvmWallet = () => {
      chromeMessageEvm<{ ok: boolean; hasWallet: boolean; unlocked: boolean; address?: string }>({ type: 'TRENCH_EVM_WALLET_STATUS' })
        .then((r) => {
          setEvmWallet({ hasWallet: r.hasWallet, unlocked: r.unlocked, address: r.address });
          if (r.address) refreshEvmBalances(r.address);
        })
        .catch(() => {});
    };
    const refreshEvmBalances = (address: string) => {
      const RH_RPC = 'https://rpc.mainnet.chain.robinhood.com';
      const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
      // ETH balance
      fetch(RH_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }) })
        .then(r => r.json()).then((d: { result?: string }) => {
          if (d.result) setEvmEthBalance(Number(BigInt(d.result)) / 1e18);
        }).catch(() => {});
      // USDG balance (balanceOf)
      const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
      fetch(RH_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: USDG, data }, 'latest'], id: 2 }) })
        .then(r => r.json()).then((d: { result?: string }) => {
          if (d.result && d.result !== '0x') setEvmUsdgBalance(Number(BigInt(d.result)) / 1e6);
        }).catch(() => {});
    };
    refreshEvmWallet();
    window.addEventListener('focus', refreshEvmWallet);
    return () => window.removeEventListener('focus', refreshEvmWallet);
  }, []);

  useEffect(() => {
    const reloadSettings = () => {
      void loadExtensionSettings().then(setSettingsState);
    };
    window.addEventListener('focus', reloadSettings);
    window.addEventListener('pageshow', reloadSettings);
    return () => {
      window.removeEventListener('focus', reloadSettings);
      window.removeEventListener('pageshow', reloadSettings);
    };
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
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('pageshow', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(() => void refresh(), 12_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('pageshow', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.clearInterval(interval);
    };
  }, [displayedWallet, pnlLedger?.costBasisSol, pnlLedger?.realizedPnlSol, settingsReady, settingsState.rpcUrl, token.mint, token.symbol]);

  useEffect(() => {
    setPnlLedger(displayedWallet && token.mint ? loadPnlLedger(displayedWallet, token.mint) : null);
  }, [displayedWallet, token.mint]);

  useEffect(() => {
    if (token.chain !== 'robinhood' || !evmWallet.address || !token.mint) {
      setEvmPnl(null);
      setEvmTokenAmount(0);
      return;
    }
    setEvmPnl(loadEvmPnlLedger(evmWallet.address, token.mint));
    let cancelled = false;
    void fetchEvmBalancePair(evmWallet.address, token.mint)
      .then((pair) => { if (!cancelled) setEvmTokenAmount(Number(pair.token) / 1e18); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token.chain, token.mint, evmWallet.address]);

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
    const forceOpen = () => {
      setCollapsed(false);
      setPosition(clampPosition({ x: 24, y: 72 }));
      setActive(true);
    };

    document.addEventListener('trench:force-open', forceOpen);
    return () => document.removeEventListener('trench:force-open', forceOpen);
  }, []);

  useEffect(() => {
    const refresh = () => setToken(isGmgnRobinhood() ? readGmgnTokenContext() : readAxiomTokenContext());
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

  function toggleEditAmounts() {
    setEditAmounts((v) => !v);
  }

  async function executeTrade(side: TradeSide, amount: number) {
    if (pendingSide) return;
    if (settingsState.confirmation) {
      setConfirmPending({ side, amount });
      return;
    }
    await doExecuteTrade(side, amount);
  }

  async function doExecuteTrade(side: TradeSide, amount: number) {
    if (pendingSide) return;
    setActive(true);
    setPendingSide(side);
    setToast({ kind: 'info', text: side === 'buy' ? 'Buying...' : 'Selling...' });

    try {
      if (token.chain === 'robinhood') {
        if (!evmWallet.hasWallet) throw new Error('Import EVM wallet in Settings first');
        if (!evmWallet.unlocked) throw new Error('EVM wallet locked — re-open Settings to unlock');
        const rhAddress = evmWallet.address;
        const before = rhAddress && token.mint ? await fetchEvmBalancePair(rhAddress, token.mint).catch(() => null) : null;
        await runEvmTrade(side, amount, token.mint, settingsState, side === 'buy' ? (evmUsdgBalance >= amount ? 'USDG' : 'ETH') : 'USDG');
        setFlash('success');
        setToast({ kind: 'success', text: side === 'buy' ? 'Buy filled' : 'Sell filled' });
        addTradeHistory(setOrders, {
          side,
          mint: token.mint,
          wallet: rhAddress ?? '',
          size: formatTradeValue(side, amount),
          status: 'Sent'
        });
        if (rhAddress && token.mint && before) {
          void refreshEvmPnlAfterTrade(rhAddress, token.mint, side, before, setEvmPnl, setEvmTokenAmount);
        }
      } else {
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
      }
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
            <div className="tw-title">{token.symbol && token.symbol !== 'TOKEN' ? token.symbol : 'Trench'}</div>
            <div className="tw-mint" title={token.mint ?? 'Token not detected'}>
              {token.mint ? shortMint(token.mint) : '—'}
            </div>
          </div>
        </div>
        <nav className="tw-header-actions tw-no-drag" aria-label="Trench actions">
          {isPublicRpc(settingsState) ? <span className="tw-rpc-warn" title="Public RPC — rate limited">PUB</span> : null}
          <IconButton label={walletButtonLabel(settingsState, wallet)} onClick={() => connectBrowserWallet(settingsState, setWallet, setToast)}>
            <Wallet size={14} />
          </IconButton>
          <IconButton label={editAmounts ? 'Done editing' : 'Edit amounts'} active={editAmounts} onClick={toggleEditAmounts}>
            <Edit3 size={14} />
          </IconButton>
          <IconButton label="Settings" active={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
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
            evmWallet={evmWallet}
            onEvmWalletImport={async (pk: string) => {
              const r = await chromeMessageEvm<{ ok: boolean; address?: string; error?: string }>({ type: 'TRENCH_EVM_WALLET_IMPORT', privateKey: pk });
              if (r.ok) {
                setEvmWallet({ hasWallet: true, unlocked: true, address: r.address });
                void loadExtensionSettings().then(setSettingsState);
              }
              return r;
            }}
            onEvmWalletForget={async () => {
              await chromeMessageEvm<{ ok: boolean }>({ type: 'TRENCH_EVM_WALLET_FORGET' });
              setEvmWallet({ hasWallet: false, unlocked: false, address: undefined });
            }}
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
          meta={token.chain === 'robinhood'
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa' }}>
                <span style={{ color: '#ccff00' }}>USDG</span> {evmUsdgBalance.toFixed(2)}
                <span style={{ color: '#666' }}>|</span>
                <span style={{ color: '#ccc' }}>ETH</span> {evmEthBalance.toFixed(4)}
              </span>
            : <><SolanaMark /> {positionLoading ? '...' : positionState.walletSol.toFixed(4)}{positionState.walletWsol > 0 ? `+${positionState.walletWsol.toFixed(4)}w` : ''} SOL</>}
          buttons={settingsState.buyAmounts}
          selected={settingsState.selectedBuyAmount}
          pending={pendingSide === 'buy'}
          settings={settingsState}
          editMode={editAmounts}
          onSelect={(value) => patchSettings({ selectedBuyAmount: value })}
          onExecute={(value) => executeTrade('buy', value)}
          onEditValue={(index, value) => {
            const next = [...settingsState.buyAmounts];
            next[index] = value;
            patchSettings({ buyAmounts: next });
          }}
        />

        <div className="tw-divider" />

        <TradeSection
          side="sell"
          title="Sell"
          meta={token.chain === 'robinhood'
            ? <span className="tw-position-meta">
                {evmTokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {token.symbol} /{' '}
                <span className={(evmPnl?.realizedPnlUsdg ?? 0) > 0 ? 'tw-positive' : (evmPnl?.realizedPnlUsdg ?? 0) < 0 ? 'tw-negative' : 'tw-muted'}>
                  RPNL {(evmPnl?.realizedPnlUsdg ?? 0).toFixed(2)} USDG
                </span>
              </span>
            : <span className="tw-position-meta">
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
          editMode={editAmounts}
          onSelect={(value) => patchSettings({ selectedSellPercent: value })}
          onExecute={(value) => executeTrade('sell', value)}
          onEditValue={(index, value) => {
            const next = [...settingsState.sellPercents];
            next[index] = value;
            patchSettings({ sellPercents: next });
          }}
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
      {confirmPending ? (
        <div className="tw-confirm-overlay">
          <div className="tw-confirm-text">
            {confirmPending.side === 'buy'
              ? `Buy ${confirmPending.amount} SOL?`
              : `Sell ${confirmPending.amount}%?`}
          </div>
          <div className="tw-confirm-actions">
            <button className="tw-confirm-cancel" type="button" onClick={() => setConfirmPending(null)}>Cancel</button>
            <button className={`tw-confirm-ok tw-confirm-${confirmPending.side}`} type="button" onClick={() => {
              const { side, amount } = confirmPending;
              setConfirmPending(null);
              void doExecuteTrade(side, amount);
            }}>Confirm</button>
          </div>
        </div>
      ) : null}
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
  editMode?: boolean;
  onSelect: (value: number) => void;
  onExecute: (value: number) => void;
  onEditValue?: (index: number, value: number) => void;
}) {
  const { side, title, meta, buttons, selected, pending, settings, editMode, onSelect, onExecute, onEditValue } = props;

  return (
    <section className={`tw-trade tw-trade-${side}`}>
      <div className="tw-section-head">
        <span className="tw-section-label">{title}</span>
        <span className="tw-section-meta">{meta}</span>
      </div>

      <div className="tw-quick-grid">
        {buttons.map((value, index) =>
          editMode ? (
            <input
              key={index}
              className={`tw-quick tw-quick-edit tw-quick-${side}`}
              type="number"
              min={0}
              step={side === 'buy' ? 0.01 : 1}
              value={value}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n > 0) onEditValue?.(index, n);
              }}
              title={side === 'buy' ? 'Buy amount' : 'Sell %'}
            />
          ) : (
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
          )
        )}
      </div>

      <div className="tw-stat-row">
        <span className="tw-stat" title="Slippage tolerance">
          <Percent size={11} /> {settings.slippage}%
        </span>
        <span className="tw-stat" title={settings.autoFee ? `Auto priority fee (${settings.autoFeeLevel})` : 'Priority fee'}>
          <Zap size={11} /> {settings.autoFee ? settings.autoFeeLevel.charAt(0).toUpperCase() + settings.autoFeeLevel.slice(1) : settings.priorityFee}
        </span>
        <span className="tw-stat" title="Jito tip">
          <Coins size={11} /> {settings.jitoTip}
        </span>
        <span className={`tw-stat ${settings.protection ? 'tw-stat-on' : 'tw-stat-off'}`} title={settings.protection ? 'MEV protection on' : 'MEV protection off'}>
          {settings.protection ? <Shield size={11} /> : <ShieldOff size={11} />} {settings.protection ? 'On' : 'Off'}
        </span>
      </div>
    </section>
  );
}

function SettingsPanel(props: {
  settings: TradeSettings;
  onChange: (patch: Partial<TradeSettings>) => void;
  evmWallet: { hasWallet: boolean; unlocked: boolean; address?: string };
  onEvmWalletImport: (pk: string) => Promise<{ ok: boolean; error?: string }>;
  onEvmWalletForget: () => Promise<void>;
  onClearHistory: () => void;
  onClearPnl: () => void;
}) {
  const { settings, onChange, evmWallet, onEvmWalletImport, onEvmWalletForget, onClearHistory, onClearPnl } = props;
  const [evmKey, setEvmKey] = useState('');
  const [evmErr, setEvmErr] = useState('');
  const [evmLoading, setEvmLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function handleEvmImport() {
    const pk = evmKey.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { setEvmErr('Invalid private key (must be 0x + 64 hex chars)'); return; }
    setEvmLoading(true); setEvmErr('');
    const r = await onEvmWalletImport(pk);
    setEvmLoading(false);
    if (!r.ok) { setEvmErr(r.error ?? 'Import failed'); return; }
    setEvmKey('');
  }

  return (
    <section className="tw-settings-panel">
      <div className="tw-settings-title">Wallets</div>
      <div className="tw-wallet-manager">
        <div className="tw-wallet-row">
          <span className="tw-wallet-label">Solana</span>
          {settings.localWalletPublicKey ? (
            <span className="tw-wallet-addr">{settings.localWalletPublicKey.slice(0,6)}…{settings.localWalletPublicKey.slice(-4)}</span>
          ) : (
            <span className="tw-wallet-empty">No wallet — import in Options</span>
          )}
          <span className={`tw-evm-dot ${settings.localWalletPublicKey ? 'tw-evm-ok' : ''}`} />
        </div>
        <div className="tw-wallet-row">
          <span className="tw-wallet-label">RH Chain</span>
          {evmWallet.hasWallet ? (
            <>
              <span className="tw-wallet-addr">{evmWallet.address ? `${evmWallet.address.slice(0,6)}…${evmWallet.address.slice(-4)}` : 'Locked'}</span>
              <span className={`tw-evm-dot ${evmWallet.unlocked ? 'tw-evm-ok' : 'tw-evm-locked'}`} />
              <button className="tw-btn-ghost-xs" type="button" onClick={onEvmWalletForget}>Forget</button>
            </>
          ) : (
            <>
              <input
                className="tw-evm-input"
                type="password"
                placeholder="0x private key"
                value={evmKey}
                onChange={(e) => setEvmKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleEvmImport(); }}
                disabled={evmLoading}
              />
              <button className="tw-btn-action-sm" type="button" onClick={handleEvmImport} disabled={evmLoading}>
                {evmLoading ? '…' : 'Import'}
              </button>
            </>
          )}
        </div>
        {evmErr && <div className="tw-evm-error">{evmErr}</div>}
      </div>

      <div className="tw-settings-group"><span><span className="tw-group-dot">·</span> Trade</span></div>
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
          <span>Slippage %</span>
          <input type="number" value={settings.slippage} onChange={(event) => onChange({ slippage: Number(event.target.value) })} />
        </label>
        <label>
          <span>Engine</span>
          <select value={settings.executionMode} onChange={(event) => onChange({ executionMode: event.target.value as TradeSettings['executionMode'] })}>
            <option value="jupiter">Jupiter</option>
            <option value="pump">Pump</option>
            <option value="auto">Auto</option>
          </select>
        </label>
        <label>
          <span>Priority fee</span>
          <input type="number" step="0.001" value={settings.priorityFee} disabled={settings.autoFee} onChange={(event) => onChange({ priorityFee: Number(event.target.value) })} />
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
          <span>Signer</span>
          <select value={settings.signerMode} onChange={(event) => onChange({ signerMode: event.target.value as TradeSettings['signerMode'] })}>
            <option value="wallet">Browser wallet</option>
            <option value="local">Local hot wallet</option>
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
      </div>

      <button className="tw-settings-group" type="button" onClick={() => setAdvancedOpen((v) => !v)}>
        <span><span className="tw-group-dot">·</span> Advanced</span>
        {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {advancedOpen ? (
        <div className="tw-settings-grid">
          <label>
            <span>Jito tip</span>
            <input type="number" step="0.001" value={settings.jitoTip} disabled={settings.autoFee} onChange={(event) => onChange({ jitoTip: Number(event.target.value) })} />
          </label>
          <label>
            <span>Auto max</span>
            <input type="number" step="0.0001" value={settings.autoFeeMax} disabled={!settings.autoFee} onChange={(event) => onChange({ autoFeeMax: Number(event.target.value) })} />
          </label>
          <label>
            <span>Send mode</span>
            <select value={settings.sendMode} onChange={(event) => onChange({ sendMode: event.target.value as TradeSettings['sendMode'] })}>
              <option value="rpc">RPC preflight</option>
              <option value="jito">Jito low latency</option>
            </select>
          </label>
          <label className="tw-toggle-row">
            <span>Jito bundleOnly</span>
            <input type="checkbox" checked={settings.jitoBundleOnly} onChange={(event) => onChange({ jitoBundleOnly: event.target.checked })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>RPC URL</span>
            <input value={settings.rpcUrl} onChange={(event) => onChange({ rpcUrl: event.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Jito endpoint</span>
            <input value={settings.jitoEndpoint} onChange={(event) => onChange({ jitoEndpoint: event.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Local pubkey</span>
            <input value={settings.localWalletPublicKey} readOnly />
          </label>
        </div>
      ) : null}

      <div className="tw-settings-actions">
        <button type="button" onClick={onClearHistory}>Clear history</button>
        <button type="button" onClick={onClearPnl}>Clear PnL</button>
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
  let publicKey: string;
  if (settings.signerMode === 'local') {
    const status = await new Promise<{ ok: boolean; publicKey?: string; error?: string }>((resolve) => {
      const sendMessage = window.chrome?.runtime?.sendMessage;
      if (!sendMessage) { resolve({ ok: false, error: 'Extension runtime unavailable' }); return; }
      sendMessage({ type: 'TRENCH_HOT_WALLET_STATUS' }, resolve);
    });
    if (!status.ok || !status.publicKey) throw new Error('Local hot wallet locked — unlock in options');
    publicKey = status.publicKey;
  } else {
    publicKey = currentWallet ?? (await walletRequest('TRENCH_WALLET_CONNECT')).publicKey ?? '';
  }
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

async function runEvmTrade(side: TradeSide, amountUsdg: number, tokenAddress: string | null, settings: TradeSettings, inputCurrency: 'USDG' | 'ETH' = 'USDG'): Promise<EvmTradeResponse> {
  if (!tokenAddress) throw new Error('No token address detected');
  if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) throw new Error('Invalid EVM token address');
  const slippageBps = Math.round(settings.slippage * 100);
  return chromeMessageEvm<EvmTradeResponse>({
    type: 'TRENCH_EVM_TRADE',
    side,
    tokenAddress,
    amountUsdg,
    slippageBps,
    inputCurrency,
  });
}

function chromeMessageEvm<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const chrome = (window as unknown as { chrome?: { runtime?: { sendMessage?: (msg: unknown, cb: (r: unknown) => void) => void } } }).chrome;
    if (!chrome?.runtime?.sendMessage) { reject(new Error('Chrome runtime unavailable')); return; }
    chrome.runtime.sendMessage(message, (response) => {
      const r = response as { ok?: boolean; error?: string } | undefined;
      if (!r) { reject(new Error('No response from background')); return; }
      if (!r.ok) { reject(new Error(r.error ?? 'EVM trade failed')); return; }
      resolve(response as T);
    });
  });
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

function initGmgnQuickBuy() {
  if (!isGmgnPage()) return;
  installGmgnStyle();
  refreshGmgnQuickBuyButtons();

  const observer = new MutationObserver(() => refreshGmgnQuickBuyButtons());
  observer.observe(document.body, { childList: true, subtree: true });

  const intervalId = window.setInterval(refreshGmgnQuickBuyButtons, 1500);

  function cleanup() {
    observer.disconnect();
    window.clearInterval(intervalId);
    window.removeEventListener('popstate', onPopState);
  }

  function onPopState() {
    cleanup();
    initGmgnQuickBuy();
  }

  window.addEventListener('popstate', onPopState);
}

function refreshGmgnQuickBuyButtons() {
  if (!isGmgnPage()) return;

  for (const card of findGmgnCards()) {
    if (card.getAttribute(GMGN_CARD_FLAG) === '1') continue;

    const address = readGmgnCardAddress(card);
    if (!address) continue;

    card.setAttribute(GMGN_CARD_FLAG, '1');
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = GMGN_BUTTON_CLASS;
    button.dataset.address = address;
    button.textContent = 'BUY';
    button.title = `Trench quick buy ${shortMint(address)}`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = readGmgnCardAddress(card) ?? address;
      void gmgnQuickBuy(button, current);
    });
    button.addEventListener('pointerdown', (event) => event.stopPropagation());

    card.appendChild(button);
  }
}

function findGmgnCards(): HTMLElement[] {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('div[class*="group/a"]'));
  return cards.filter((card) => card.offsetWidth > 260 && card.offsetHeight > 60);
}

function readGmgnCardAddress(card: HTMLElement): string | null {
  for (const anchor of Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const match = (anchor.getAttribute('href') ?? '').match(EVM_ADDRESS_PATTERN);
    if (match) return match[0].toLowerCase();
  }

  for (const element of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const match = attribute.value.match(EVM_ADDRESS_PATTERN);
      if (match) return match[0].toLowerCase();
    }
  }

  return null;
}

async function gmgnQuickBuy(button: HTMLButtonElement, address: string) {
  if (button.disabled) return;
  button.disabled = true;
  button.dataset.state = 'pending';
  button.textContent = '…';

  try {
    const settings = await loadExtensionSettings();
    const status = await chromeMessageEvm<EvmWalletResponse>({ type: 'TRENCH_EVM_WALLET_STATUS' }).catch(() => null);
    if (!status?.hasWallet) throw new Error('Import RH wallet');
    if (!status.unlocked) throw new Error('Wallet locked');

    const amountUsdg = settings.selectedBuyAmount || settings.buyAmounts[0] || defaultSettings.selectedBuyAmount;
    const slippageBps = Math.round(settings.slippage * 100);
    const result = await runEvmTrade('buy', amountUsdg, address, settings, 'USDG');

    addTradeHistoryDirect({
      side: 'buy',
      mint: address,
      wallet: status.address ?? '',
      signature: result.hash,
      summary: `RH buy ${amountUsdg} USDG`,
      size: formatTradeValue('buy', amountUsdg),
      status: 'Sent'
    });
    button.dataset.state = 'success';
    button.textContent = 'BOUGHT';
    window.setTimeout(() => resetGmgnButton(button), 2600);
  } catch (error) {
    addTradeHistoryDirect({
      side: 'buy',
      mint: address,
      wallet: '',
      error: error instanceof Error ? error.message : 'Quick buy failed',
      size: 'buy',
      status: 'Failed'
    });
    button.dataset.state = 'error';
    button.textContent = error instanceof Error ? error.message.slice(0, 18) : 'Failed';
    window.setTimeout(() => resetGmgnButton(button), 3200);
  }
}

function resetGmgnButton(button: HTMLButtonElement) {
  button.disabled = false;
  button.dataset.state = '';
  button.textContent = 'BUY';
}

function installGmgnStyle() {
  if (document.getElementById(GMGN_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = GMGN_STYLE_ID;
  style.textContent = `
    .${GMGN_BUTTON_CLASS} {
      position: absolute;
      top: 6px;
      right: 8px;
      z-index: 60;
      display: inline-flex;
      height: 20px;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      border: 1px solid rgba(204, 255, 0, 0.5);
      border-radius: 4px;
      background: rgba(20, 26, 5, 0.95);
      color: #ccff00;
      cursor: pointer;
      font: 700 9px/1 "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      opacity: 0.85;
      transition: opacity 80ms, border-color 80ms, color 80ms;
    }
    .${GMGN_BUTTON_CLASS}:hover { opacity: 1; border-color: #ccff00; color: #e4ff70; }
    .${GMGN_BUTTON_CLASS}:disabled { cursor: wait; }
    .${GMGN_BUTTON_CLASS}[data-state="pending"] { opacity: 1; }
    .${GMGN_BUTTON_CLASS}[data-state="success"] { border-color: #ccff00; color: #ccff00; opacity: 1; }
    .${GMGN_BUTTON_CLASS}[data-state="error"] { border-color: #ff5c72; color: #ff5c72; opacity: 1; }
  `;
  document.head.appendChild(style);
}

function isGmgnPage() {
  return window.location.hostname === 'gmgn.ai';
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
      border: 1px solid #23280e;
      border-radius: 4px;
      background: #0d0d11;
      color: #ccff00;
      cursor: pointer;
      font: 700 9px/1 "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .${PULSE_BUTTON_CLASS}:hover { border-color: rgba(204, 255, 0, 0.45); background: rgba(204, 255, 0, 0.06); color: #e4ff70; }
    .${PULSE_BUTTON_CLASS}:disabled { cursor: wait; opacity: 0.5; }
    .${PULSE_BUTTON_CLASS}[data-state="success"] { border-color: rgba(204, 255, 0, 0.5); color: #ccff00; }
    .${PULSE_BUTTON_CLASS}[data-state="error"] { border-color: #281820; color: #ff5c72; }
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

async function refreshEvmPnlAfterTrade(
  address: string,
  token: string,
  side: TradeSide,
  before: EvmBalancePair,
  setEvmPnl: (ledger: EvmPnlLedger) => void,
  setEvmTokenAmount: React.Dispatch<React.SetStateAction<number>>
) {
  await delay(6000);
  const after = await fetchEvmBalancePair(address, token).catch(() => null);
  if (!after) return;
  const next = updateEvmPnlLedger(address, token, side, before, after);
  setEvmPnl(next);
  setEvmTokenAmount(Number(after.token) / 1e18);
}

function updateEvmPnlLedger(address: string, token: string, side: TradeSide, before: EvmBalancePair, after: EvmBalancePair): EvmPnlLedger {
  const current = loadEvmPnlLedger(address, token) ?? { rawTokenAmount: '0', costBasisUsdg: 0, realizedPnlUsdg: 0, updatedAt: Date.now() };
  const tokenDelta = after.token - before.token;
  const usdgDelta = Number(after.usdg - before.usdg) / 1e6;

  let rawTokenAmount = BigInt(current.rawTokenAmount);
  let costBasisUsdg = current.costBasisUsdg;
  let realizedPnlUsdg = current.realizedPnlUsdg;

  if (side === 'buy' && tokenDelta > 0n && usdgDelta < 0) {
    rawTokenAmount += tokenDelta;
    costBasisUsdg += Math.abs(usdgDelta);
  }

  if (side === 'sell' && tokenDelta < 0n && usdgDelta > 0 && rawTokenAmount > 0n && costBasisUsdg > 0) {
    const soldRaw = minBigInt(-tokenDelta, rawTokenAmount);
    const soldRatio = Number((soldRaw * 1_000_000n) / rawTokenAmount) / 1_000_000;
    const removedCostBasis = costBasisUsdg * soldRatio;
    rawTokenAmount -= soldRaw;
    costBasisUsdg = Math.max(0, costBasisUsdg - removedCostBasis);
    realizedPnlUsdg += usdgDelta - removedCostBasis;
  }

  const next: EvmPnlLedger = {
    rawTokenAmount: rawTokenAmount.toString(),
    costBasisUsdg,
    realizedPnlUsdg,
    updatedAt: Date.now()
  };
  saveEvmPnlLedger(address, token, next);
  return next;
}

function loadEvmPnlLedger(address: string, token: string): EvmPnlLedger | null {
  const store = loadEvmPnlStore();
  return store[evmPnlKey(address, token)] ?? null;
}

function saveEvmPnlLedger(address: string, token: string, ledger: EvmPnlLedger) {
  const store = loadEvmPnlStore();
  store[evmPnlKey(address, token)] = ledger;
  localStorage.setItem(EVM_PNL_LEDGER_KEY, JSON.stringify(store));
}

function loadEvmPnlStore(): Record<string, EvmPnlLedger> {
  try {
    return JSON.parse(localStorage.getItem(EVM_PNL_LEDGER_KEY) ?? '{}') as Record<string, EvmPnlLedger>;
  } catch {
    return {};
  }
}

function evmPnlKey(address: string, token: string) {
  return `${address.toLowerCase()}:${token.toLowerCase()}`;
}

async function fetchEvmBalancePair(address: string, token: string): Promise<EvmBalancePair> {
  const [tokenRaw, usdgRaw] = await Promise.all([
    fetchEvmRawBalance(address, token),
    fetchEvmRawBalance(address, RH_USDG_ADDRESS)
  ]);
  return { token: tokenRaw, usdg: usdgRaw };
}

async function fetchEvmRawBalance(address: string, token: string): Promise<bigint> {
  const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
  const response = await fetch(RH_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: token, data }, 'latest'], id: 1 })
  });
  const payload = (await response.json().catch(() => null)) as { result?: string } | null;
  return payload?.result && payload.result !== '0x' ? BigInt(payload.result) : 0n;
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
  void window.chrome?.runtime?.sendMessage?.({ type: 'TRENCH_SYNC_TRADE_HISTORY', entries: next });
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
  const url = settings.rpcUrl;
  return url.includes('api.mainnet-beta.solana.com')
    || url.includes('solana-rpc.publicnode.com')
    || url.includes('solana.drpc.org');
}

function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sanitizePresetName(name: string) {
  return name.trim().replace(/\s+/g, ' ').slice(0, 24) || 'Preset';
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
