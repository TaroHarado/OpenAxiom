import type { TradeSettings, WidgetPosition } from './types';

export const SETTINGS_KEY = 'trench.settings.v1';
const POSITION_KEY = 'trench.position.v1';
const COLLAPSED_KEY = 'trench.collapsed.v1';

export const defaultSettings: TradeSettings = {
  buyAmounts: [0.0005, 0.5, 2, 5],
  sellPercents: [10, 30, 70, 100],
  selectedBuyAmount: 0.5,
  selectedSellPercent: 30,
  slippage: 30,
  hotkeys: true,
  showOnGmgn: true
};

const fallbackPosition: WidgetPosition = { x: 24, y: 72 };

export function loadSettings(): TradeSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings;

  try {
    const parsed = JSON.parse(raw) as Partial<TradeSettings>;
    const normalized = normalizeSettings(parsed);
    const serialized = JSON.stringify(normalized);
    if (raw !== serialized) localStorage.setItem(SETTINGS_KEY, serialized);
    return normalized;
  } catch {
    return defaultSettings;
  }
}

export async function loadExtensionSettings(): Promise<TradeSettings> {
  const chromeStorage = getChromeStorage();
  if (!chromeStorage) return loadSettings();

  const stored = await chromeStorage.get([SETTINGS_KEY]);
  const parsed = stored[SETTINGS_KEY] as Partial<TradeSettings> | undefined;
  const normalized = normalizeSettings(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await chromeStorage.set({ [SETTINGS_KEY]: normalized });
  }
  return normalized;
}

export function saveSettings(settings: TradeSettings) {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  void getChromeStorage()?.set({ [SETTINGS_KEY]: normalized });
}

export async function saveExtensionSettings(settings: TradeSettings) {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  await getChromeStorage()?.set({ [SETTINGS_KEY]: normalized });
}

export async function resetExtensionSettings() {
  await saveExtensionSettings(defaultSettings);
  return defaultSettings;
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

function normalizeSettings(settings?: Partial<TradeSettings>): TradeSettings {
  const merged = { ...defaultSettings, ...settings };
  const buyAmounts = normalizeNumberList(merged.buyAmounts, defaultSettings.buyAmounts, 4);
  const sellPercents = normalizeNumberList(merged.sellPercents, defaultSettings.sellPercents, 4).map((value) => Math.min(100, value));
  const selectedBuyAmount = positiveNumber(merged.selectedBuyAmount, defaultSettings.selectedBuyAmount);
  const selectedSellPercent = Math.min(100, positiveNumber(merged.selectedSellPercent, defaultSettings.selectedSellPercent));
  return {
    buyAmounts,
    sellPercents,
    selectedBuyAmount: buyAmounts.includes(selectedBuyAmount) ? selectedBuyAmount : buyAmounts[0],
    selectedSellPercent: sellPercents.includes(selectedSellPercent) ? selectedSellPercent : sellPercents[0],
    slippage: clampNumber(merged.slippage, 0, 50, defaultSettings.slippage),
    hotkeys: Boolean(merged.hotkeys),
    showOnGmgn: merged.showOnGmgn !== false
  };
}

function normalizeNumberList(value: unknown, fallback: number[], maxLength: number) {
  const parsed = Array.isArray(value) ? value.filter((item) => Number.isFinite(item) && item > 0).slice(0, maxLength) : [];
  if (!parsed.length) return [...fallback];
  return [...parsed, ...fallback.slice(parsed.length, maxLength)].slice(0, maxLength);
}

function positiveNumber(value: unknown, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function getChromeStorage() {
  return globalThis.chrome?.storage?.local;
}
