import type { TradeSettings, WidgetPosition } from './types';

const SETTINGS_KEY = 'tradewiz.settings.v1';
const POSITION_KEY = 'tradewiz.position.v1';
const COLLAPSED_KEY = 'tradewiz.collapsed.v1';

export const defaultSettings: TradeSettings = {
  buyAmounts: [0.0005, 0.5, 2, 5],
  sellPercents: [10, 30, 70, 100],
  selectedBuyAmount: 0.5,
  selectedSellPercent: 30,
  slippage: 30,
  priorityFee: 0.001,
  jitoTip: 0.001,
  protection: true,
  confirmation: false,
  hotkeys: true,
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  executionMode: 'jupiter'
};

const fallbackPosition: WidgetPosition = { x: 24, y: 72 };

export function loadSettings(): TradeSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings;

  try {
    const parsed = JSON.parse(raw) as Partial<TradeSettings>;
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: TradeSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadPosition(): WidgetPosition {
  const raw = localStorage.getItem(POSITION_KEY);
  if (!raw) return fallbackPosition;

  try {
    const parsed = JSON.parse(raw) as WidgetPosition;
    return {
      x: Number.isFinite(parsed.x) ? parsed.x : fallbackPosition.x,
      y: Number.isFinite(parsed.y) ? parsed.y : fallbackPosition.y
    };
  } catch {
    return fallbackPosition;
  }
}

export function savePosition(position: WidgetPosition) {
  localStorage.setItem(POSITION_KEY, JSON.stringify(position));
}

export function loadCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_KEY) === 'true';
}

export function saveCollapsed(collapsed: boolean) {
  localStorage.setItem(COLLAPSED_KEY, String(collapsed));
}
