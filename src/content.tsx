import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Loader2,
  Percent,
  Settings,
  Users,
  X,
  Zap
} from 'lucide-react';
import { isInvalidExtensionContext, selectQuickBuyAmount, stopOverlayEvent } from './contentControls';
import { isGmgnRobinhood, readGmgnTokenContext } from './gmgn';
import {
  defaultSettings,
  loadCollapsed,
  loadExtensionSettings,
  loadPosition,
  saveCollapsed,
  saveExtensionSettings,
  savePosition,
  saveSettings
} from './storage';
import type { EvmAccountsResponse, EvmBatchTradeResponse, ToastKind, TokenContext, TradeOrder, TradeSettings, TradeSide } from './types';
import styles from './styles.css?inline';

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        getURL?: (path: string) => string;
        sendMessage?: (message: unknown, callback?: (response: unknown) => void) => void;
      };
    };
  }
}

const ROOT_ID = 'trench-shadow-root';
const GMGN_STYLE_ID = 'trench-gmgn-style';
const GMGN_BUTTON_CLASS = 'trench-gmgn-buy';
const GMGN_CONTROL_CLASS = 'trench-gmgn-controls';
const GMGN_AMOUNT_CLASS = 'trench-gmgn-amount';
const GMGN_CARD_FLAG = 'data-trench-gmgn';
const SETTINGS_CHANGE_EVENT = 'trench:settings-change';
const EVM_ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;
const GMGN_TOKEN_PATH = /\/robinhood\/token\/(?:[^/]*?_)?(0x[0-9a-fA-F]{40})/i;
const RH_INFRA_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  '0xcaf681a66d020601342297493863e78c959e5cb2',
  '0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77',
]);
const EVM_PNL_LEDGER_KEY = 'trench.evmPnl.v1';
const TRADE_HISTORY_KEY = 'trench.tradeHistory.v1';
const RH_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const RH_USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

type EvmPnlLedger = {
  rawTokenAmount: string;
  costBasisEth: number;
  realizedPnlEth: number;
  updatedAt: number;
};

type EvmBalancePair = { token: bigint; eth: bigint; tokenDecimals: number };

function mount() {
  if (!isGmgnPage()) return;
  if (document.getElementById(ROOT_ID)) return;
  console.info('[Trench] content script mounted', window.location.href);

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  const rootNode = document.createElement('div');
  shadow.appendChild(rootNode);

  const root = createRoot(rootNode);
  root.render(<TrenchController />);

  window.addEventListener('beforeunload', () => {
    root.unmount();
    host.remove();
  }, { once: true });
}

function TrenchController() {
  const [settings, setSettings] = useState<TradeSettings | null>(null);
  const [robinhoodPage, setRobinhoodPage] = useState(isGmgnRobinhood);

  useEffect(() => {
    const load = () => void loadExtensionSettings().then(setSettings);
    const apply = (event: Event) => setSettings((event as CustomEvent<TradeSettings>).detail);
    const applyStorageChange = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && changes['trench.settings.v1']) load();
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('pageshow', load);
    document.addEventListener(SETTINGS_CHANGE_EVENT, apply);
    globalThis.chrome?.storage?.onChanged?.addListener(applyStorageChange);
    return () => {
      window.removeEventListener('focus', load);
      window.removeEventListener('pageshow', load);
      document.removeEventListener(SETTINGS_CHANGE_EVENT, apply);
      globalThis.chrome?.storage?.onChanged?.removeListener(applyStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!settings?.showOnGmgn) return;
    const syncRoute = () => setRobinhoodPage(isGmgnRobinhood());
    syncRoute();
    const observer = new MutationObserver(syncRoute);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', syncRoute);
    const intervalId = window.setInterval(syncRoute, 1000);
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', syncRoute);
      window.clearInterval(intervalId);
    };
  }, [settings?.showOnGmgn]);

  useEffect(() => {
    if (!settings?.showOnGmgn || !robinhoodPage) {
      removeGmgnQuickBuyControls();
      return;
    }
    return initGmgnQuickBuy();
  }, [robinhoodPage, settings?.showOnGmgn]);

  async function setVisible(showOnGmgn: boolean) {
    const current = settings ?? await loadExtensionSettings();
    const next = { ...current, showOnGmgn };
    if (showOnGmgn) setRobinhoodPage(isGmgnRobinhood());
    setSettings(next);
    await saveExtensionSettings(next);
    document.dispatchEvent(new CustomEvent<TradeSettings>(SETTINGS_CHANGE_EVENT, { detail: next }));
  }

  if (!settings) return null;

  return (
    <>
      <label className={`tw-page-switch ${settings.showOnGmgn ? 'tw-page-switch-on' : ''}`}>
        <span className="tw-page-switch-label">Trench</span>
        <input type="checkbox" checked={settings.showOnGmgn} onChange={(event) => void setVisible(event.target.checked)} />
        <span className="tw-page-switch-track" aria-hidden="true"><span /></span>
        <strong>{settings.showOnGmgn ? 'On' : 'Off'}</strong>
      </label>
      {robinhoodPage && settings.showOnGmgn ? <TrenchOverlay /> : null}
    </>
  );
}

function TrenchOverlay() {
  const [settingsState, setSettingsState] = useState<TradeSettings>(defaultSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [position, setPosition] = useState(() => clampPosition(loadPosition()));
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [editAmounts, setEditAmounts] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [token, setToken] = useState<TokenContext>(readGmgnTokenContext);
  const [orders, setOrders] = useState<TradeOrder[]>(() => loadTradeHistory());
  const [pendingSide, setPendingSide] = useState<TradeSide | null>(null);
  const [evmWallet, setEvmWallet] = useState<{ hasWallet: boolean; address?: string }>({ hasWallet: false });
  const [evmAccounts, setEvmAccounts] = useState<EvmAccountsResponse>({ ok: true, accounts: [], activeAccountId: null, selectedAccountIds: [] });
  const [evmEthBalance, setEvmEthBalance] = useState<number>(0);
  const [evmUsdgBalance, setEvmUsdgBalance] = useState<number>(0);
  const [evmPnl, setEvmPnl] = useState<EvmPnlLedger | null>(null);
  const [evmTokenAmount, setEvmTokenAmount] = useState(0);
  const [toast, setToast] = useState<{ kind: ToastKind; text: string; signature?: string } | null>(null);
  const [flash, setFlash] = useState<ToastKind | null>(null);
  const [active, setActive] = useState(false);
  const dragRef = useRef({ dragging: false, dx: 0, dy: 0 });
  const balanceSequence = useRef(0);

  const walletReady = evmWallet.hasWallet;
  const activeEvmAccount = evmAccounts.accounts.find((account) => account.id === evmAccounts.activeAccountId);

  function refreshEvmBalances(address: string) {
    const sequence = ++balanceSequence.current;
    setEvmEthBalance(0);
    setEvmUsdgBalance(0);
    void Promise.all([
      fetchEvmEthBalance(address),
      fetchEvmRawBalance(address, RH_USDG_ADDRESS).then((value) => Number(value) / 1e6),
    ]).then(([eth, usdg]) => {
      if (sequence !== balanceSequence.current) return;
      setEvmEthBalance(eth);
      setEvmUsdgBalance(usdg);
    }).catch(() => {});
  }

  function clearEvmBalances() {
    balanceSequence.current += 1;
    setEvmEthBalance(0);
    setEvmUsdgBalance(0);
  }

  useEffect(() => {
    void loadExtensionSettings().then((loaded) => {
      setSettingsState(loaded);
      setSettingsReady(true);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshEvmWallet = () => {
      chromeMessageEvm<EvmAccountsResponse>({ type: 'TRENCH_EVM_ACCOUNTS_LIST' })
        .then((r) => {
          if (disposed) return;
          setEvmAccounts(r);
          const active = r.accounts.find((account) => account.id === r.activeAccountId);
          setEvmWallet({ hasWallet: Boolean(active), address: active?.address });
          if (active?.address) refreshEvmBalances(active.address);
          else clearEvmBalances();
        })
        .catch(() => {});
    };
    refreshEvmWallet();
    window.addEventListener('focus', refreshEvmWallet);
    window.addEventListener('pageshow', refreshEvmWallet);
    const interval = window.setInterval(refreshEvmWallet, 5_000);
    const storage = (window as unknown as { chrome?: { storage?: { onChanged?: { addListener?: (listener: (changes: Record<string, unknown>, areaName: string) => void) => void; removeListener?: (listener: (changes: Record<string, unknown>, areaName: string) => void) => void } } } }).chrome?.storage;
    const onStorageChange = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName === 'local' && ('trench.evmAccounts.v2' in changes || 'trench.evmLegacyMigration.v1' in changes)) refreshEvmWallet();
    };
    storage?.onChanged?.addListener?.(onStorageChange);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshEvmWallet);
      window.removeEventListener('pageshow', refreshEvmWallet);
      window.clearInterval(interval);
      storage?.onChanged?.removeListener?.(onStorageChange);
    };
  }, []);

  useEffect(() => {
    const reloadSettings = () => {
      void loadExtensionSettings().then(setSettingsState);
    };
    const applySettings = (event: Event) => {
      setSettingsState((event as CustomEvent<TradeSettings>).detail);
    };
    window.addEventListener('focus', reloadSettings);
    window.addEventListener('pageshow', reloadSettings);
    document.addEventListener(SETTINGS_CHANGE_EVENT, applySettings);
    return () => {
      window.removeEventListener('focus', reloadSettings);
      window.removeEventListener('pageshow', reloadSettings);
      document.removeEventListener(SETTINGS_CHANGE_EVENT, applySettings);
    };
  }, []);

  useEffect(() => {
    if (!evmWallet.address || !token.mint) {
      setEvmPnl(null);
      setEvmTokenAmount(0);
      return;
    }
    setEvmPnl(loadEvmPnlLedger(evmWallet.address, token.mint));
    let cancelled = false;
    void fetchEvmBalancePair(evmWallet.address, token.mint)
      .then((pair) => { if (!cancelled) setEvmTokenAmount(formatEvmTokenAmount(pair.token, pair.tokenDecimals)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token.mint, evmWallet.address]);

  useEffect(() => {
    if (!settingsReady) return;
    saveSettings(settingsState);
    syncGmgnAmountControls(settingsState);
  }, [settingsReady, settingsState]);

  useEffect(() => {
    savePosition(position);
  }, [position]);

  useEffect(() => {
    const keepVisible = () => setPosition((current) => clampPosition(current));
    window.addEventListener('resize', keepVisible);
    return () => window.removeEventListener('resize', keepVisible);
  }, []);

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
    const refresh = () => setToken(readGmgnTokenContext());
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
        void executeTrade('buy', settingsState.buyAmounts[buyIndex], event.isTrusted);
      }

      const sellIndex = ['q', 'w', 'e', 'r'].indexOf(key);
      if (sellIndex >= 0) {
        event.preventDefault();
        void executeTrade('sell', settingsState.sellPercents[sellIndex], event.isTrusted);
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

  async function executeTrade(side: TradeSide, amount: number, trusted: boolean) {
    if (pendingSide || !trusted) return;
    await doExecuteTrade(side, amount);
  }

  async function doExecuteTrade(side: TradeSide, amount: number) {
    if (pendingSide) return;
    if (!isGmgnRobinhood()) throw new Error('Robinhood Chain page required');
    setActive(true);
    setPendingSide(side);
    setToast({ kind: 'info', text: side === 'buy' ? 'Buying...' : 'Selling...' });

    try {
      if (!evmWallet.hasWallet) throw new Error('Create or import a wallet in Options');
      const rhAddress = activeEvmAccount?.address;
      const accountIds = evmAccounts.selectedAccountIds.length ? evmAccounts.selectedAccountIds : (evmAccounts.activeAccountId ? [evmAccounts.activeAccountId] : []);
      const beforeBalances = new Map<string, EvmBalancePair>();
      if (token.mint) {
        await Promise.all(accountIds.map(async (accountId) => {
          const account = evmAccounts.accounts.find((item) => item.id === accountId);
          if (!account) return;
          const balance = await fetchEvmBalancePair(account.address, token.mint!).catch(() => null);
          if (balance) beforeBalances.set(accountId, balance);
        }));
      }
      const batch = await runEvmBatchTrade(side, amount, token.mint, settingsState, accountIds);
      const filled = batch.results.filter((result) => result.ok).length;
      const failed = batch.results.length - filled;
      setFlash(failed ? 'error' : 'success');
      setToast({ kind: failed ? 'error' : 'success', text: `${side === 'buy' ? 'Buy' : 'Sell'} ${filled}/${batch.results.length} wallets${failed ? ` · ${failed} failed` : ''}` });
      batch.results.forEach((result) => addTradeHistory(setOrders, {
        side,
        mint: token.mint,
        wallet: result.address,
        signature: result.hash,
        summary: result.name,
        error: result.error,
        size: formatTradeValue(side, amount),
        status: result.ok ? 'Sent' : 'Failed'
      }));
      if (token.mint) {
        for (const result of batch.results) {
          const before = beforeBalances.get(result.accountId);
          if (result.ok && before) {
            void refreshEvmPnlAfterTrade(result.address, token.mint, side, before, (ledger) => {
              if (result.address.toLowerCase() === rhAddress?.toLowerCase()) setEvmPnl(ledger);
            }, (amount) => {
              if (result.address.toLowerCase() === rhAddress?.toLowerCase()) setEvmTokenAmount(amount);
            }, refreshEvmBalances);
          }
        }
      }
    } catch (error) {
      addTradeHistory(setOrders, {
        side,
        mint: token.mint,
        wallet: activeEvmAccount?.address ?? '',
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
        onPointerDown={stopOverlayEvent}
        onClick={(event) => {
          stopOverlayEvent(event);
          setCollapsed(false);
        }}
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
      onPointerDown={(event) => {
        stopOverlayEvent(event);
        setActive(true);
      }}
      onClick={stopOverlayEvent}
      onFocus={() => setActive(true)}
    >
      <header className="tw-header" onPointerDown={startDrag}>
        <div className="tw-brand">
          <div className="tw-logo">TR</div>
          <div className="tw-title-wrap">
            <div className="tw-eyebrow">Robinhood Chain</div>
            <div className="tw-title-line">
              <div className="tw-title">{token.symbol && token.symbol !== 'TOKEN' ? token.symbol : 'Trench'}</div>
              <div className="tw-mint" title={token.mint ?? 'Token not detected'}>{token.mint ? shortMint(token.mint) : '—'}</div>
            </div>
          </div>
        </div>
        <nav className="tw-header-actions tw-no-drag" aria-label="Trench actions">
          <IconButton label="Select accounts" active={accountsOpen} onClick={() => setAccountsOpen((value) => !value)}>
            <Users size={14} />
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

        {accountsOpen ? (
          <AccountPicker accounts={evmAccounts} onChange={async (message) => {
            const next = await chromeMessageEvm<EvmAccountsResponse>(message);
            setEvmAccounts(next);
            const active = next.accounts.find((account) => account.id === next.activeAccountId);
            setEvmWallet({ hasWallet: Boolean(active), address: active?.address });
            if (active?.address) refreshEvmBalances(active.address);
            else clearEvmBalances();
          }} />
        ) : null}

        <section className="tw-command-strip" aria-label="Trading status">
          <div className={`tw-status-tile ${walletReady ? 'tw-status-ready' : 'tw-status-warn'}`}>
            <span>Wallet</span>
            <strong>{walletReady ? activeEvmAccount?.name ?? shortMint(evmWallet.address ?? '') : 'Not ready'}</strong>
          </div>
          <div className="tw-status-tile">
            <span>Balance</span>
            <strong>{evmEthBalance.toFixed(4)} ETH</strong>
          </div>
          <div className="tw-status-tile">
            <span>Batch</span>
            <strong>{evmAccounts.selectedAccountIds.length} wallets</strong>
          </div>
        </section>

        {settingsOpen ? (
          <SettingsPanel
            settings={settingsState}
            onChange={patchSettings}
            evmWallet={evmWallet}
            onClearHistory={() => {
              localStorage.removeItem(TRADE_HISTORY_KEY);
              setOrders([]);
              setToast({ kind: 'info', text: 'Trade history cleared' });
            }}
            onClearPnl={() => {
              localStorage.removeItem(EVM_PNL_LEDGER_KEY);
              setEvmPnl(null);
              setToast({ kind: 'info', text: 'Local PnL cleared' });
            }}
          />
        ) : null}

            <TradeSection
          side="buy"
          title="Buy"
          meta={<span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa' }}>
                <span style={{ color: '#14f195' }}>USDG</span> {evmUsdgBalance.toFixed(2)}
                <span style={{ color: '#666' }}>|</span>
                <span style={{ color: '#ccc' }}>ETH</span> {evmEthBalance.toFixed(4)}
              </span>}
          buttons={settingsState.buyAmounts}
              unit="ETH"
          selected={settingsState.selectedBuyAmount}
          pending={pendingSide === 'buy'}
          settings={settingsState}
          editMode={editAmounts}
              onSelect={(value) => patchSettings({ selectedBuyAmount: value })}
              onPrewarm={() => token.mint && chromeMessageEvm<{ ok: boolean }>({ type: 'TRENCH_EVM_PREWARM_ROUTE', tokenAddress: token.mint }).catch(() => {})}
              onExecute={(value, trusted) => executeTrade('buy', value, trusted)}
          onEditValue={(index, value) => {
            const next = [...settingsState.buyAmounts];
            const previous = next[index];
            next[index] = value;
            patchSettings({
              buyAmounts: next,
              selectedBuyAmount: settingsState.selectedBuyAmount === previous
                ? value
                : next.includes(settingsState.selectedBuyAmount) ? settingsState.selectedBuyAmount : next[0],
            });
          }}
        />

        <TradeSection
          side="sell"
          title="Sell"
          meta={(() => {
                const rpnl = evmPnl?.realizedPnlEth ?? 0;
                const cost = evmPnl?.costBasisEth ?? 0;
                const pct = cost > 0 ? (rpnl / cost) * 100 : null;
                const cls = rpnl > 0 ? 'tw-positive' : rpnl < 0 ? 'tw-negative' : 'tw-muted';
                return (
                  <span className="tw-position-meta">
                    {evmTokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {token.symbol}
                    {' / '}
                    <span className={cls}>
                      {rpnl >= 0 ? '+' : ''}{rpnl.toFixed(6)} ETH
                      {pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}
                    </span>
                  </span>
                );
              })()
          }
          buttons={settingsState.sellPercents}
              unit="of position"
          selected={settingsState.selectedSellPercent}
          pending={pendingSide === 'sell'}
          settings={settingsState}
          editMode={editAmounts}
              onSelect={(value) => patchSettings({ selectedSellPercent: value })}
              onPrewarm={() => token.mint && chromeMessageEvm<{ ok: boolean }>({ type: 'TRENCH_EVM_PREWARM_ROUTE', tokenAddress: token.mint, side: 'sell' }).catch(() => {})}
              onExecute={(value, trusted) => executeTrade('sell', value, trusted)}
          onEditValue={(index, value) => {
            const next = [...settingsState.sellPercents];
            const previous = next[index];
            next[index] = value;
            patchSettings({
              sellPercents: next,
              selectedSellPercent: settingsState.selectedSellPercent === previous
                ? value
                : next.includes(settingsState.selectedSellPercent) ? settingsState.selectedSellPercent : next[0],
            });
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
                      <a className="tw-cancel" href={tradeExplorerUrl(order)} target="_blank" rel="noreferrer">View</a>
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
  unit: string;
  selected: number;
  pending: boolean;
  settings: TradeSettings;
  editMode?: boolean;
  onSelect: (value: number) => void;
  onPrewarm?: () => void;
  onExecute: (value: number, trusted: boolean) => void;
  onEditValue?: (index: number, value: number) => void;
}) {
  const { side, title, meta, buttons, unit, selected, pending, settings, editMode, onSelect, onPrewarm, onExecute, onEditValue } = props;

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
              onPointerEnter={onPrewarm}
              onClick={(event) => {
                onSelect(value);
                onExecute(value, event.nativeEvent.isTrusted);
              }}
              disabled={pending}
            >
              <span className="tw-quick-value">
                {pending && value === selected ? <Loader2 className="tw-spin" size={13} /> : null}
                {pending && value === selected ? (side === 'buy' ? 'Buying...' : 'Selling...') : formatTradeValue(side, value)}
              </span>
              <small>{unit}</small>
            </button>
          )
        )}
      </div>

      <div className="tw-stat-row">
        <span className="tw-stat" title="Slippage tolerance">
          <Percent size={11} /> {settings.slippage}%
        </span>
        <span className="tw-stat" title="Every transaction is simulated before submission">
          <CheckCircle2 size={11} /> Simulated
        </span>
        <span className="tw-stat" title="Robinhood Chain">
          <Zap size={11} /> Native ETH
        </span>
      </div>
    </section>
  );
}

function AccountPicker(props: { accounts: EvmAccountsResponse; onChange: (message: unknown) => Promise<void> }) {
  const { accounts, onChange } = props;
  return (
    <section className="tw-account-picker">
      <div className="tw-account-picker-head">
        <div><strong>Execution wallets</strong><span>{accounts.selectedAccountIds.length} selected for batch</span></div>
        <button type="button" onClick={() => window.open(window.chrome?.runtime?.getURL?.('options.html'), '_blank')}>Manage</button>
      </div>
      <div className="tw-account-picker-list">
        {accounts.accounts.map((account) => (
          <div className={`tw-account-pick-row${account.active ? ' tw-account-pick-active' : ''}`} key={account.id}>
            <button className="tw-account-radio" type="button" title="Make active" onClick={() => onChange({ type: 'TRENCH_EVM_ACCOUNT_SET_ACTIVE', accountId: account.id })}><span /></button>
            <button className="tw-account-identity" type="button" onClick={() => onChange({ type: 'TRENCH_EVM_ACCOUNT_SET_ACTIVE', accountId: account.id })}><strong>{account.name}</strong><small>{shortMint(account.address)}</small></button>
            <label className="tw-account-check"><input type="checkbox" checked={account.selected} onChange={() => {
              const accountIds = account.selected
                ? accounts.selectedAccountIds.filter((id) => id !== account.id)
                : [...accounts.selectedAccountIds, account.id];
              if (!accountIds.length) return;
              void onChange({ type: 'TRENCH_EVM_ACCOUNTS_SET_SELECTED', accountIds });
            }} /><span>{account.selected ? 'Batch' : 'Add'}</span></label>
          </div>
        ))}
        {!accounts.accounts.length ? <div className="tw-account-picker-empty">No accounts. Open Manage to create one.</div> : null}
      </div>
    </section>
  );
}

function SettingsPanel(props: {
  settings: TradeSettings;
  onChange: (patch: Partial<TradeSettings>) => void;
  evmWallet: { hasWallet: boolean; address?: string };
  onClearHistory: () => void;
  onClearPnl: () => void;
}) {
  const { settings, onChange, evmWallet, onClearHistory, onClearPnl } = props;

  return (
    <section className="tw-settings-panel">
      <div className="tw-settings-title">Wallet</div>
      <div className="tw-wallet-manager">
        <div className="tw-wallet-row">
          <span className="tw-wallet-label">Robinhood Chain</span>
          {evmWallet.hasWallet ? (
            <>
              <span className="tw-wallet-addr">{evmWallet.address ? `${evmWallet.address.slice(0,6)}…${evmWallet.address.slice(-4)}` : 'No active wallet'}</span>
              <span className="tw-evm-dot tw-evm-ok" />
            </>
          ) : (
            <span className="tw-wallet-empty">Create or import in Options</span>
          )}
        </div>
        <button className="tw-btn-action-sm" type="button" onClick={() => window.open(window.chrome?.runtime?.getURL?.('options.html'), '_blank')}>Manage accounts</button>
      </div>

      <div className="tw-settings-group"><span><span className="tw-group-dot">·</span> Trade</span></div>
      <div className="tw-settings-grid">
        <PresetFields
          label="Buy amounts"
          values={settings.buyAmounts}
          suffix="ETH"
          step={0.0001}
          onChange={(buyAmounts) => onChange({
            buyAmounts,
            selectedBuyAmount: buyAmounts.includes(settings.selectedBuyAmount) ? settings.selectedBuyAmount : buyAmounts[0],
          })}
        />
        <PresetFields
          label="Sell position"
          values={settings.sellPercents}
          suffix="%"
          step={1}
          max={100}
          onChange={(sellPercents) => onChange({
            sellPercents,
            selectedSellPercent: sellPercents.includes(settings.selectedSellPercent) ? settings.selectedSellPercent : sellPercents[0],
          })}
        />
        <label>
          <span>Slippage %</span>
          <input type="number" value={settings.slippage} onChange={(event) => onChange({ slippage: Number(event.target.value) })} />
        </label>
        <label className="tw-toggle-row">
          <span>Hotkeys</span>
          <input type="checkbox" checked={settings.hotkeys} onChange={(event) => onChange({ hotkeys: event.target.checked })} />
        </label>
      </div>

      <div className="tw-settings-actions">
        <button type="button" onClick={onClearHistory}>Clear history</button>
        <button type="button" onClick={onClearPnl}>Clear PnL</button>
      </div>
    </section>
  );
}

function PresetFields(props: { label: string; values: number[]; suffix: string; step: number; max?: number; onChange: (values: number[]) => void }) {
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
    <fieldset className="tw-preset-fields">
      <legend>{props.label}</legend>
      <div>
        {props.values.map((value, index) => (
          <label key={index}>
            <input
              type="number"
              min={props.step}
              max={props.max}
              step={props.step}
              value={drafts[index] ?? String(value)}
              aria-label={`${props.label} ${index + 1}`}
              onChange={(event) => update(index, event.target.value)}
              onBlur={() => setDrafts(props.values.map(String))}
            />
            <span>{props.suffix}</span>
          </label>
        ))}
      </div>
    </fieldset>
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
  const href = toast.signature ? `https://robinhoodchain.blockscout.com/tx/${toast.signature}` : undefined;

  return (
    <div className={`tw-toast tw-toast-${toast.kind}`}>
      {toast.kind === 'success' ? <CheckCircle2 size={14} /> : toast.kind === 'error' ? <X size={14} /> : <Loader2 className="tw-spin" size={14} />}
      <span>{toast.text}</span>
      {toast.signature ? (
        <a href={href} target="_blank" rel="noreferrer" title={toast.signature}>tx</a>
      ) : null}
    </div>
  );
}

async function runEvmBatchTrade(
  side: TradeSide,
  amountUsdg: number,
  tokenAddress: string | null,
  settings: TradeSettings,
  accountIds: string[],
): Promise<EvmBatchTradeResponse> {
  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) throw new Error('Invalid EVM token address');
  if (!accountIds.length) throw new Error('Select at least one wallet');
  await ensureRuntimeReady();
  return chromeMessageEvm<EvmBatchTradeResponse>({
    type: 'TRENCH_EVM_BATCH_TRADE',
    side,
    tokenAddress,
    amountUsdg,
    slippageBps: Math.round(settings.slippage * 100),
    accountIds,
  });
}

function chromeMessageEvm<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const chrome = (window as unknown as { chrome?: { runtime?: { sendMessage?: (msg: unknown, cb: (r: unknown) => void) => void } } }).chrome;
    if (!chrome?.runtime?.sendMessage) { reject(new Error('Chrome runtime unavailable')); return; }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = (window.chrome?.runtime as { lastError?: { message?: string } } | undefined)?.lastError;
        if (runtimeError) { reject(new Error(runtimeError.message ?? 'Extension messaging failed')); return; }
        const r = response as { ok?: boolean; error?: string } | undefined;
        if (!r) { reject(new Error('No response from background')); return; }
        if (!r.ok) { reject(new Error(r.error ?? 'EVM trade failed')); return; }
        resolve(response as T);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Extension context unavailable'));
    }
  });
}

async function ensureRuntimeReady() {
  try {
    await chromeMessageEvm<{ ok: boolean }>({ type: 'TRENCH_RUNTIME_PING' });
  } catch (error) {
    if (isInvalidExtensionContext(error)) {
      window.location.reload();
      throw new Error('Extension updated. Reloading page before trade.');
    }
    throw error;
  }
}

function initGmgnQuickBuy() {
  if (!isGmgnPage()) return undefined;
  installGmgnStyle();
  refreshGmgnQuickBuyButtons();

  const observer = new MutationObserver(() => refreshGmgnQuickBuyButtons());
  observer.observe(document.body, { childList: true, subtree: true });

  const intervalId = window.setInterval(refreshGmgnQuickBuyButtons, 1500);

  function cleanup() {
    observer.disconnect();
    window.clearInterval(intervalId);
    window.removeEventListener('popstate', onPopState);
    removeGmgnQuickBuyControls();
  }

  function onPopState() {
    refreshGmgnQuickBuyButtons();
  }

  window.addEventListener('popstate', onPopState);
  return cleanup;
}

function refreshGmgnQuickBuyButtons() {
  if (!isGmgnRobinhood()) {
    removeGmgnQuickBuyControls();
    return;
  }
  installGmgnStyle();

  for (const card of findGmgnCards()) {
    if (card.getAttribute(GMGN_CARD_FLAG) === '1') continue;

    const address = readGmgnCardAddress(card);
    if (!address) continue;

    card.setAttribute(GMGN_CARD_FLAG, '1');

    const controls = document.createElement('div');
    controls.className = GMGN_CONTROL_CLASS;

    const amountSelect = document.createElement('select');
    amountSelect.className = GMGN_AMOUNT_CLASS;
    amountSelect.title = 'Quick-buy amount';
    amountSelect.setAttribute('aria-label', 'Quick-buy amount');
    amountSelect.addEventListener('pointerdown', stopOverlayEvent);
    amountSelect.addEventListener('click', stopOverlayEvent);
    amountSelect.addEventListener('change', (event) => {
      event.stopPropagation();
      void updateGmgnQuickBuyAmount(Number(amountSelect.value));
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = GMGN_BUTTON_CLASS;
    button.dataset.address = address;
    button.textContent = 'BUY';
    void chromeMessageEvm<EvmAccountsResponse>({ type: 'TRENCH_EVM_ACCOUNTS_LIST' })
      .then((accounts) => { button.textContent = `BUY · ${accounts.selectedAccountIds.length || 1}W`; })
      .catch(() => {});
    button.title = `Trench quick buy ${shortMint(address)}`;
    button.addEventListener('pointerenter', () => {
      void chromeMessageEvm<{ ok: boolean }>({ type: 'TRENCH_EVM_PREWARM_ROUTE', tokenAddress: address }).catch(() => {});
    }, { once: true });
    button.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const current = readGmgnCardAddress(card) ?? address;
      void gmgnQuickBuy(button, current);
    });
    button.addEventListener('pointerdown', (event) => event.stopPropagation());

    controls.append(amountSelect, button);
    card.appendChild(controls);
    void syncGmgnAmountSelect(amountSelect);
  }
}

function removeGmgnQuickBuyControls() {
  document.querySelectorAll(`.${GMGN_CONTROL_CLASS}`).forEach((control) => control.remove());
  document.querySelectorAll(`[${GMGN_CARD_FLAG}]`).forEach((card) => card.removeAttribute(GMGN_CARD_FLAG));
  document.getElementById(GMGN_STYLE_ID)?.remove();
}

async function syncGmgnAmountSelect(select: HTMLSelectElement, loadedSettings?: TradeSettings) {
  const settings = loadedSettings ?? await loadExtensionSettings();
  select.replaceChildren(...settings.buyAmounts.map((amount) => {
    const option = document.createElement('option');
    option.value = String(amount);
    option.textContent = `${amount} ETH`;
    return option;
  }));

  if (!settings.buyAmounts.includes(settings.selectedBuyAmount)) {
    const option = document.createElement('option');
    option.value = String(settings.selectedBuyAmount);
    option.textContent = `${settings.selectedBuyAmount} ETH`;
    select.appendChild(option);
  }
  select.value = String(settings.selectedBuyAmount);
}

function syncGmgnAmountControls(settings: TradeSettings) {
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>(`.${GMGN_AMOUNT_CLASS}`))) {
    void syncGmgnAmountSelect(select, settings);
  }
}

async function updateGmgnQuickBuyAmount(amount: number) {
  const current = await loadExtensionSettings();
  const next = selectQuickBuyAmount(current, amount);
  if (next === current) return;
  await saveExtensionSettings(next);
  document.dispatchEvent(new CustomEvent<TradeSettings>(SETTINGS_CHANGE_EVENT, { detail: next }));
  syncGmgnAmountControls(next);
}

function findGmgnCards(): HTMLElement[] {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('div[class*="group/a"]'));
  return cards.filter((card) => card.offsetWidth > 260 && card.offsetHeight > 60);
}

function readGmgnCardAddress(card: HTMLElement): string | null {
  for (const anchor of Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const match = (anchor.getAttribute('href') ?? '').match(GMGN_TOKEN_PATH);
    if (match) return match[1].toLowerCase();
  }

  for (const anchor of Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const match = (anchor.getAttribute('href') ?? '').match(EVM_ADDRESS_PATTERN);
    const address = match?.[0].toLowerCase();
    if (address && !RH_INFRA_ADDRESSES.has(address)) return address;
  }

  for (const element of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const match = attribute.value.match(EVM_ADDRESS_PATTERN);
      const address = match?.[0].toLowerCase();
      if (address && !RH_INFRA_ADDRESSES.has(address)) return address;
    }
  }

  return null;
}

async function gmgnQuickBuy(button: HTMLButtonElement, address: string) {
  if (!isGmgnRobinhood()) throw new Error('Robinhood Chain page required');
  if (button.disabled) return;
  button.disabled = true;
  button.dataset.state = 'pending';
  button.textContent = '…';

  try {
    await ensureRuntimeReady();
    const settings = await loadExtensionSettings();
    const accounts = await chromeMessageEvm<EvmAccountsResponse>({ type: 'TRENCH_EVM_ACCOUNTS_LIST' });
    const accountIds = accounts.selectedAccountIds.length ? accounts.selectedAccountIds : (accounts.activeAccountId ? [accounts.activeAccountId] : []);
    if (!accountIds.length) throw new Error('Select RH wallet');

    const amountEth = settings.selectedBuyAmount || settings.buyAmounts[0] || defaultSettings.selectedBuyAmount;
    const batch = await runEvmBatchTrade('buy', amountEth, address, settings, accountIds);
    const filled = batch.results.filter((result) => result.ok).length;
    batch.results.forEach((result) => addTradeHistoryDirect({
      side: 'buy', mint: address, wallet: result.address, signature: result.hash,
      summary: `${result.name} · ${amountEth} ETH`, error: result.error,
      size: formatTradeValue('buy', amountEth), status: result.ok ? 'Sent' : 'Failed'
    }));
    button.dataset.state = 'success';
    button.dataset.wallets = String(batch.results.length);
    button.textContent = `${filled}/${batch.results.length}`;
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
  void chromeMessageEvm<EvmAccountsResponse>({ type: 'TRENCH_EVM_ACCOUNTS_LIST' })
    .then((accounts) => { button.textContent = `BUY · ${accounts.selectedAccountIds.length || 1}W`; })
    .catch(() => { button.textContent = 'BUY'; });
}

function installGmgnStyle() {
  if (document.getElementById(GMGN_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = GMGN_STYLE_ID;
  style.textContent = `
    .${GMGN_BUTTON_CLASS} {
      display: inline-flex;
      height: 30px;
      align-items: center;
      justify-content: center;
      padding: 0 10px;
      border: 1px solid rgba(20, 241, 149, 0.42);
      border-radius: 5px;
      background: rgba(15, 36, 25, 0.94);
      color: #14f195;
      cursor: pointer;
      font: 800 9px/1 "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
      letter-spacing: 0;
      text-transform: uppercase;
      white-space: nowrap;
      opacity: 0.85;
      transition: opacity 80ms, border-color 80ms, color 80ms;
    }
    .${GMGN_BUTTON_CLASS}:hover { opacity: 1; border-color: #14f195; background: rgba(18, 51, 33, 0.98); color: #7dffc6; }
    .${GMGN_BUTTON_CLASS}:focus-visible { outline: 2px solid #14f195; outline-offset: 2px; }
    .${GMGN_BUTTON_CLASS}:disabled { cursor: wait; }
    .${GMGN_BUTTON_CLASS}[data-state="pending"] { opacity: 1; }
    .${GMGN_BUTTON_CLASS}[data-state="success"] { border-color: #14f195; color: #14f195; opacity: 1; }
    .${GMGN_BUTTON_CLASS}[data-state="error"] { border-color: #ff607a; color: #ff607a; opacity: 1; }
    .${GMGN_CONTROL_CLASS} {
      position: static;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      align-self: center;
      margin: 6px 8px 6px auto;
    }
    .${GMGN_AMOUNT_CLASS} {
      width: 78px;
      height: 30px;
      padding: 0 4px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 5px;
      background: rgba(10, 13, 17, 0.96);
      color: #d7dce5;
      cursor: pointer;
      font: 600 9px/1 "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
      letter-spacing: 0;
      outline: none;
    }
    .${GMGN_AMOUNT_CLASS}:hover { border-color: rgba(20, 241, 149, 0.42); }
    .${GMGN_AMOUNT_CLASS}:focus-visible { outline: 2px solid #14f195; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}

function isGmgnPage() {
  return window.location.hostname === 'gmgn.ai';
}

async function refreshEvmPnlAfterTrade(
  address: string,
  token: string,
  side: TradeSide,
  before: EvmBalancePair,
  setEvmPnl: (ledger: EvmPnlLedger) => void,
  setEvmTokenAmount: (amount: number) => void,
  refreshEvmBalances: (address: string) => void,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(1_000);
    const after = await fetchEvmBalancePair(address, token).catch(() => null);
    if (!after) continue;
    if (after.token === before.token && after.eth === before.eth) continue;
    const next = updateEvmPnlLedger(address, token, side, before, after);
    setEvmPnl(next);
    setEvmTokenAmount(formatEvmTokenAmount(after.token, after.tokenDecimals));
    refreshEvmBalances(address);
    return;
  }
}

function updateEvmPnlLedger(address: string, token: string, side: TradeSide, before: EvmBalancePair, after: EvmBalancePair): EvmPnlLedger {
  const current = loadEvmPnlLedger(address, token) ?? { rawTokenAmount: '0', costBasisEth: 0, realizedPnlEth: 0, updatedAt: Date.now() };
  const tokenDelta = after.token - before.token;
  const ethDelta = Number(after.eth - before.eth) / 1e18;

  let rawTokenAmount = BigInt(current.rawTokenAmount);
  let costBasisEth = current.costBasisEth;
  let realizedPnlEth = current.realizedPnlEth;

  if (side === 'buy' && tokenDelta > 0n && ethDelta < 0) {
    rawTokenAmount += tokenDelta;
    costBasisEth += Math.abs(ethDelta);
  }

  if (side === 'sell' && tokenDelta < 0n && ethDelta > 0 && rawTokenAmount > 0n && costBasisEth > 0) {
    const soldRaw = minBigInt(-tokenDelta, rawTokenAmount);
    const soldRatio = Number((soldRaw * 1_000_000n) / rawTokenAmount) / 1_000_000;
    const removedCostBasis = costBasisEth * soldRatio;
    rawTokenAmount -= soldRaw;
    costBasisEth = Math.max(0, costBasisEth - removedCostBasis);
    realizedPnlEth += ethDelta - removedCostBasis;
  }

  const next: EvmPnlLedger = {
    rawTokenAmount: rawTokenAmount.toString(),
    costBasisEth,
    realizedPnlEth,
    updatedAt: Date.now()
  };
  saveEvmPnlLedger(address, token, next);
  return next;
}

function loadEvmPnlLedger(address: string, token: string): EvmPnlLedger | null {
  const store = loadEvmPnlStore();
  const ledger = store[evmPnlKey(address, token)];
  return ledger && Number.isFinite(ledger.costBasisEth) && Number.isFinite(ledger.realizedPnlEth) ? ledger : null;
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
  const [tokenRaw, ethRaw, tokenDecimals] = await Promise.all([
    fetchEvmRawBalance(address, token),
    fetchEvmRawEthBalance(address),
    fetchEvmTokenDecimals(token),
  ]);
  return { token: tokenRaw, eth: ethRaw, tokenDecimals };
}

function formatEvmTokenAmount(raw: bigint, decimals: number) {
  return Number(raw) / 10 ** decimals;
}

async function fetchEvmTokenDecimals(token: string): Promise<number> {
  const response = await fetch(RH_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: token, data: '0x313ce567' }, 'latest'], id: 1 }),
  });
  const payload = await response.json() as { result?: string };
  const decimals = payload.result ? Number(BigInt(payload.result)) : 18;
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : 18;
}

async function fetchEvmRawEthBalance(address: string): Promise<bigint> {
  const response = await fetch(RH_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
  });
  const payload = await response.json() as { result?: string };
  return payload.result ? BigInt(payload.result) : 0n;
}

async function fetchEvmEthBalance(address: string): Promise<number> {
  const response = await fetch(RH_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
  });
  const payload = await response.json() as { result?: string };
  return payload.result ? Number(BigInt(payload.result)) / 1e18 : 0;
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
  return order.mint ? `TX ${shortMint(order.mint)}` : 'TX';
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function clampPosition(position: { x: number; y: number }) {
  const widgetWidth = Math.min(312, window.innerWidth - 16);
  const maxX = Math.max(8, window.innerWidth - widgetWidth - 8);
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

function tradeExplorerUrl(order: TradeOrder) {
  return `https://robinhoodchain.blockscout.com/tx/${order.signature}`;
}

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

mount();
