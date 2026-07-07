import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { defaultSettings, loadExtensionSettings, PUBLIC_TEST_RPC_URL, resetExtensionSettings, saveExtensionSettings } from './storage';
import type { TradeSettings } from './types';
import './options.css';

function OptionsApp() {
  const [settings, setSettings] = useState<TradeSettings>(defaultSettings);
  const [status, setStatus] = useState('Loading settings');

  useEffect(() => {
    void loadExtensionSettings().then((loaded) => {
      setSettings(loaded);
      setStatus('Ready');
    });
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

  return (
    <main className="options-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">TradeWiz for Axiom</p>
          <h1>Execution Settings</h1>
          <p className="subcopy">Configure the floating trading overlay. Private keys stay in your wallet; this extension only prepares wallet-signed transactions.</p>
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
          <Field label="RPC URL">
            <input value={settings.rpcUrl} onChange={(event) => patch({ rpcUrl: event.target.value })} />
          </Field>
          <button className="ghost" type="button" onClick={() => patch({ rpcUrl: PUBLIC_TEST_RPC_URL })}>Use public test RPC</button>
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

      <footer className="action-bar">
        <button className="secondary" type="button" onClick={reset}><RotateCcw size={16} /> Reset</button>
        <button className="primary" type="button" onClick={save}><Save size={16} /> Save settings</button>
      </footer>
    </main>
  );
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

function parseNumberList(value: string, fallback: number[], maxLength: number) {
  const parsed = value.split(/[\s,]+/).map((part) => Number(part.trim())).filter((part) => Number.isFinite(part) && part > 0).slice(0, maxLength);
  return parsed.length ? parsed : fallback;
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
