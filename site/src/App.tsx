import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  Gauge,
  KeyRound,
  LockKeyhole,
  Menu,
  Radio,
  Route,
  ShieldCheck,
  Terminal,
  Wallet,
  X,
  Zap,
} from 'lucide-react';

type Surface = 'execution' | 'trenches';
type Side = 'buy' | 'sell';

const GITHUB_URL = 'https://github.com/TaroHarado/Trench';

const routeStages = [
  { label: 'Route discovery', value: 'WETH / V3 1%', time: '122 ms', state: 'done' },
  { label: 'Contract simulation', value: 'eth_call', time: '116 ms', state: 'done' },
  { label: 'Local signing', value: 'device key', time: 'ready', state: 'active' },
  { label: 'Network receipt', value: 'after submit', time: 'pending', state: 'idle' },
];

const trenchRows = [
  { symbol: 'APEMAN', name: 'APEMAN', age: '18s', fee: '1.00%', liquidity: '$31.4K', route: 'V3', tone: 'lime' },
  { symbol: 'AROUNSHARK', name: 'Around Shark', age: '42s', fee: '1.00%', liquidity: '$38.2K', route: 'V3', tone: 'cyan' },
  { symbol: 'CLUSTY', name: 'Clusty AI', age: '3m', fee: 'Bonding', liquidity: '$24.8K', route: 'Virtuals', tone: 'violet' },
  { symbol: 'WAVE', name: 'Wave Protocol', age: '8m', fee: '0.30%', liquidity: '$91.6K', route: 'V3', tone: 'coral' },
];

const rails = [
  { chain: 'Robinhood', venue: 'Uniswap V3', detail: 'Direct + multihop', latency: 'Native ETH', icon: 'U' },
  { chain: 'Robinhood', venue: 'Virtuals', detail: 'Bonding route', latency: 'Single transaction', icon: 'V' },
  { chain: 'Robinhood', venue: 'Doppler V4', detail: 'Initializer discovery', latency: 'Native ETH', icon: 'D' },
  { chain: 'Robinhood', venue: 'Flap', detail: 'Portal route', latency: 'Simulated first', icon: 'F' },
];

function Logo() {
  return (
    <a className="brand" href="#top" aria-label="Trench home">
      <span className="brand-mark"><span>TR</span></span>
      <span className="brand-word">Trench</span>
    </a>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />
        <nav className={open ? 'nav nav-open' : 'nav'} aria-label="Primary navigation">
          <a href="#terminal" onClick={() => setOpen(false)}>Terminal</a>
          <a href="#routes" onClick={() => setOpen(false)}>Routes</a>
          <a href="#custody" onClick={() => setOpen(false)}>Custody</a>
          <a href="#source" onClick={() => setOpen(false)}>Source</a>
        </nav>
        <div className="header-actions">
          <a className="icon-link" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="Open Trench on GitHub" title="GitHub">
            <Code2 size={17} />
          </a>
          <a className="header-cta" href={`${GITHUB_URL}#quick-start`} target="_blank" rel="noreferrer">
            Install <ArrowDownToLine size={14} />
          </a>
          <button className="menu-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Toggle navigation">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function TradeTicket({ side, setSide }: { side: Side; setSide: (side: Side) => void }) {
  const presets = side === 'buy' ? ['0.01', '0.05', '0.10', '0.25'] : ['25%', '50%', '75%', '100%'];
  return (
    <div className="trade-ticket">
      <div className="ticket-head">
        <div>
          <span className="micro-label">RH / APEMAN</span>
          <strong>Execution ticket</strong>
        </div>
        <span className="live-pill"><span /> Live</span>
      </div>
      <div className="side-control" role="group" aria-label="Trade side">
        <button className={side === 'buy' ? 'active' : ''} type="button" onClick={() => setSide('buy')}>Buy</button>
        <button className={side === 'sell' ? 'active sell' : ''} type="button" onClick={() => setSide('sell')}>Sell</button>
      </div>
      <div className="ticket-balance"><span>Available</span><strong>{side === 'buy' ? '0.8421 ETH' : '128,402 APEMAN'}</strong></div>
      <div className="preset-grid">
        {presets.map((preset, index) => <button className={index === 1 ? 'selected' : ''} type="button" key={preset}>{preset}</button>)}
      </div>
      <div className="ticket-route">
        <div><Route size={14} /><span>Route</span></div>
        <strong>{side === 'buy' ? 'ETH -> WETH -> APEMAN' : 'APEMAN -> USDG'}</strong>
      </div>
      <button className={side === 'buy' ? 'execute-button' : 'execute-button execute-sell'} type="button">
        <Zap size={15} fill="currentColor" /> {side === 'buy' ? 'Review buy' : 'Review sell'}
      </button>
      <p className="ticket-note"><ShieldCheck size={12} /> Simulation required before local signing</p>
    </div>
  );
}

function ExecutionSurface() {
  const [side, setSide] = useState<Side>('buy');
  return (
    <div className="execution-layout">
      <div className="trace-panel">
        <div className="surface-title">
          <div><CircleDot size={15} /><span>Transaction trace</span></div>
          <span className="trace-id">TRACE 7F2A</span>
        </div>
        <div className="trace-flow">
          {routeStages.map((stage, index) => (
            <div className={`trace-step trace-${stage.state}`} key={stage.label}>
              <div className="trace-axis">
                <span>{stage.state === 'done' ? <Check size={11} /> : index + 1}</span>
              </div>
              <div className="trace-copy">
                <span>{stage.label}</span>
                <strong>{stage.value}</strong>
              </div>
              <code>{stage.time}</code>
            </div>
          ))}
        </div>
        <div className="trace-footer">
          <span><Radio size={12} /> rpc.mainnet.chain.robinhood.com</span>
          <strong>4663</strong>
        </div>
      </div>
      <TradeTicket side={side} setSide={setSide} />
    </div>
  );
}

function TrenchesSurface() {
  return (
    <div className="trenches-surface">
      <div className="trenches-toolbar">
        <div><Radio size={14} /><strong>Robinhood feed</strong><span>Block 12,241,991</span></div>
        <div className="feed-filters"><button className="active" type="button">New pools</button><button type="button">Bonding</button><button type="button">Migrated</button></div>
      </div>
      <div className="feed-head"><span>Asset</span><span>Age</span><span>Liquidity</span><span>Rail</span><span>Fee</span><span /></div>
      <div className="feed-rows">
        {trenchRows.map((row) => (
          <div className="feed-row" key={row.symbol}>
            <div className="asset-cell"><span className={`token-avatar token-${row.tone}`}>{row.symbol[0]}</span><div><strong>{row.symbol}</strong><span>{row.name}</span></div></div>
            <code>{row.age}</code><strong>{row.liquidity}</strong><span className="route-badge">{row.route}</span><code>{row.fee}</code>
            <button type="button" title={`Buy ${row.symbol}`}><Zap size={13} fill="currentColor" /> Buy</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductSurface() {
  const [surface, setSurface] = useState<Surface>('execution');
  return (
    <div className="product-window">
      <div className="window-chrome">
        <div className="window-brand"><span className="mini-mark">TR</span><strong>Control room</strong></div>
        <div className="surface-tabs">
          <button className={surface === 'execution' ? 'active' : ''} type="button" onClick={() => setSurface('execution')}><Terminal size={13} /> Execution</button>
          <button className={surface === 'trenches' ? 'active' : ''} type="button" onClick={() => setSurface('trenches')}><Gauge size={13} /> Trenches</button>
        </div>
        <span className="window-status"><span /> RPC online</span>
      </div>
      {surface === 'execution' ? <ExecutionSurface /> : <TrenchesSurface />}
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-backdrop" aria-hidden="true"><span className="chain-line line-a" /><span className="chain-line line-b" /><span className="chain-line line-c" /></div>
      <div className="hero-inner">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-light" /> Open-source execution terminal</div>
          <h1>Trench</h1>
          <p className="hero-lede">Trade Robinhood Chain markets from the charts you already use, with local signing and zero platform fees in one compact terminal.</p>
          <div className="hero-actions">
            <a className="primary-action" href={`${GITHUB_URL}#quick-start`} target="_blank" rel="noreferrer"><Code2 size={16} /> Install from source <ChevronRight size={15} /></a>
            <a className="text-action" href="#terminal">Inspect the terminal <ArrowUpRight size={14} /></a>
          </div>
          <div className="hero-facts">
            <div><strong>0%</strong><span>Platform fee</span></div>
            <div><strong>1</strong><span>Chain</span></div>
            <div><strong>Local</strong><span>Key custody</span></div>
          </div>
        </div>
        <div className="hero-product"><ProductSurface /></div>
      </div>
      <div className="hero-next" aria-hidden="true"><span>Live surfaces</span><span>Overlay / Trenches / Wallets</span></div>
    </section>
  );
}

function TerminalSection() {
  return (
    <section className="section-band terminal-band" id="terminal">
      <div className="section-inner">
        <div className="section-heading split-heading">
          <div><span className="section-kicker">Product surfaces</span><h2>One terminal across the full trade.</h2></div>
          <p>Discover a pool, inspect the route, execute from an overlay, and track the result without moving custody to a hosted terminal.</p>
        </div>
        <div className="surface-grid">
          <article className="feature-surface overlay-surface">
            <div className="feature-label"><Terminal size={14} /><span>01 / Chart overlay</span></div>
            <div className="browser-frame">
              <div className="browser-bar"><span /><span /><span /><code>gmgn.ai/robinhood/token/0x0152...812c</code></div>
              <div className="chart-area">
                <div className="chart-grid" />
                <svg className="price-line" viewBox="0 0 600 240" preserveAspectRatio="none" aria-hidden="true"><path d="M0,196 C45,188 58,211 102,176 S165,151 198,165 S249,124 290,138 S348,96 388,110 S435,62 478,79 S535,36 600,43" /><path className="fill" d="M0,196 C45,188 58,211 102,176 S165,151 198,165 S249,124 290,138 S348,96 388,110 S435,62 478,79 S535,36 600,43 L600,240 L0,240 Z" /></svg>
                <div className="overlay-card">
                  <div className="overlay-head"><strong>APEMAN</strong><span>RH</span></div>
                  <div className="overlay-tabs"><span className="active">Buy</span><span>Sell</span></div>
                  <div className="overlay-presets"><span>0.01</span><span className="active">0.05</span><span>0.10</span></div>
                  <button type="button">Buy with ETH</button>
                </div>
              </div>
            </div>
            <div className="feature-copy"><h3>Execution stays on the chart.</h3><p>The draggable panel mounts on GMGN Robinhood token pages, with hotkeys, position state, batch accounts, and explicit transaction status.</p></div>
          </article>
          <article className="feature-surface feed-surface">
            <div className="feature-label"><Radio size={14} /><span>02 / Trenches feed</span></div>
            <div className="mini-feed">
              {trenchRows.slice(0, 3).map((row, index) => <div key={row.symbol}><span className={`token-avatar token-${row.tone}`}>{row.symbol[0]}</span><p><strong>{row.symbol}</strong><small>{row.name}</small></p><code>{index === 2 ? 'VIRTUALS' : 'V3 / 1%'}</code><button type="button"><Zap size={12} fill="currentColor" /> Buy</button></div>)}
            </div>
            <div className="feature-copy"><h3>New pools arrive as actions.</h3><p>Trenches watches supported factories, filters empty liquidity, resolves token metadata, and keeps every buy bound to its detected pool.</p></div>
          </article>
        </div>
      </div>
    </section>
  );
}

function RoutesSection() {
  return (
    <section className="section-band routes-band" id="routes">
      <div className="section-inner route-layout">
        <div className="route-intro">
          <span className="section-kicker">Execution rails</span>
          <h2>Route by market structure.</h2>
          <p>Trench uses the venue that owns the liquidity. Every Robinhood Chain buy preserves native ETH input and simulates before submission.</p>
          <div className="invariant"><ShieldCheck size={16} /><span><strong>Native-buy invariant</strong>One payable transaction. No separate WETH deposit or approval.</span></div>
        </div>
        <div className="rail-list">
          {rails.map((rail, index) => <div className="rail-row" key={rail.venue}><span className="rail-index">0{index + 1}</span><span className="rail-icon">{rail.icon}</span><div><span>{rail.chain}</span><strong>{rail.venue}</strong></div><div><span>Mode</span><strong>{rail.detail}</strong></div><code>{rail.latency}</code></div>)}
        </div>
      </div>
    </section>
  );
}

function CustodySection() {
  return (
    <section className="section-band custody-band" id="custody">
      <div className="section-inner custody-layout">
        <div className="wallet-visual">
          <div className="wallet-window">
            <div className="wallet-title"><Wallet size={15} /><strong>Wallets</strong><span>Device encrypted</span></div>
            <div className="wallet-columns">
              <div><span className="wallet-chain"><i className="rh-dot" /> Robinhood Chain</span><strong>0x8F2...91A0</strong><p>0.842 ETH</p><span className="wallet-state"><Check size={11} /> Unlocked</span></div>
            </div>
            <div className="key-boundary"><KeyRound size={14} /><span>Raw keys remain in extension session memory</span><LockKeyhole size={14} /></div>
          </div>
        </div>
        <div className="custody-copy">
          <span className="section-kicker">Custody boundary</span><h2>Your signer. Your RPC. Your transaction.</h2>
          <p>Imported burner keys are encrypted with a device-local AES-GCM key in extension storage. Trading pages receive account IDs and addresses, never private keys.</p>
          <div className="security-points"><span><Check size={13} /> No hosted transaction processor</span><span><Check size={13} /> No hidden treasury transfer</span><span><Check size={13} /> No telemetry backend</span></div>
        </div>
      </div>
    </section>
  );
}

function SourceSection() {
  return (
    <section className="section-band source-band" id="source">
      <div className="section-inner source-layout">
        <div><span className="section-kicker">Open source / MIT</span><h2>Audit the path before you trade it.</h2><p>The extension, route builders, local custody logic, and interface are available as one repository.</p></div>
        <div className="command-block"><div><span /><span /><span /><code>terminal</code></div><pre><span>$</span> git clone {GITHUB_URL}.git{`\n`}<span>$</span> cd Trench{`\n`}<span>$</span> npm install{`\n`}<span>$</span> npm run build</pre><a href={GITHUB_URL} target="_blank" rel="noreferrer"><Code2 size={15} /> Read the source <ExternalLink size={13} /></a></div>
      </div>
    </section>
  );
}

function Footer() {
  return <footer><div className="footer-inner"><Logo /><p>Local-first execution for Robinhood Chain.</p><div><a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a><a href={`${GITHUB_URL}#security-notes`} target="_blank" rel="noreferrer">Security</a><span>MIT</span></div></div><div className="footer-disclaimer">Experimental software. Verify routes and signatures. Use a dedicated wallet with limited funds.</div></footer>;
}

export default function App() {
  return <><Header /><main><Hero /><TerminalSection /><RoutesSection /><CustodySection /><SourceSection /></main><Footer /></>;
}
