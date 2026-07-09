import type { TradePreset, TradePresetState, TradeSettings, WidgetPosition } from './types';

export const SETTINGS_KEY = 'trench.settings.v1';
export const PRESETS_KEY = 'trench.presets.v1';
const POSITION_KEY = 'trench.position.v1';
const COLLAPSED_KEY = 'trench.collapsed.v1';
export const PUBLIC_TEST_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const PUBLICNODE_RPC_URL = 'https://solana-rpc.publicnode.com';
export const DRPC_RPC_URL = 'https://solana.drpc.org';
export const HELIUS_RPC_TEMPLATE = 'https://mainnet.helius-rpc.com/?api-key=';
export const SHYFT_RPC_TEMPLATE = 'https://rpc.shyft.to?api_key=';
export const JITO_MAINNET_TRANSACTION_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';

export const defaultSettings: TradeSettings = {
  buyAmounts: [0.0005, 0.5, 2, 5],
  sellPercents: [10, 30, 70, 100],
  selectedBuyAmount: 0.5,
  selectedSellPercent: 30,
  slippage: 30,
  priorityFee: 0.001,
  jitoTip: 0.001,
  autoFee: true,
  autoFeeLevel: 'fast',
  autoFeeMax: 0.003,
  protection: true,
  confirmation: false,
  hotkeys: true,
  rpcUrl: PUBLICNODE_RPC_URL,
  signerMode: 'wallet',
  localWalletPublicKey: '',
  sendMode: 'rpc',
  jitoEndpoint: JITO_MAINNET_TRANSACTION_URL,
  jitoBundleOnly: false,
  executionMode: 'jupiter'
};

export const defaultTradePresets: TradePreset[] = [
  {
    id: 'scalp',
    name: 'Scalp',
    settings: {
      ...defaultSettings,
      buyAmounts: [0.0005, 0.1, 0.25, 0.5],
      sellPercents: [25, 50, 75, 100],
      selectedBuyAmount: 0.1,
      selectedSellPercent: 50,
      autoFeeLevel: 'fast'
    },
    updatedAt: 0
  },
  {
    id: 'standard',
    name: 'Standard',
    settings: { ...defaultSettings },
    updatedAt: 0
  },
  {
    id: 'ape',
    name: 'Ape',
    settings: {
      ...defaultSettings,
      buyAmounts: [0.5, 1, 2, 5],
      selectedBuyAmount: 1,
      slippage: 45,
      autoFeeLevel: 'turbo',
      autoFeeMax: 0.01,
      sendMode: 'jito',
      jitoBundleOnly: true
    },
    updatedAt: 0
  }
];

const fallbackPosition: WidgetPosition = { x: 24, y: 72 };

export function loadSettings(): TradeSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings;

  try {
    const parsed = JSON.parse(raw) as Partial<TradeSettings>;
    return normalizeSettings(parsed);
  } catch {
    return defaultSettings;
  }
}

export async function loadExtensionSettings(): Promise<TradeSettings> {
  const chromeStorage = getChromeStorage();
  if (!chromeStorage) return loadSettings();

  const stored = await chromeStorage.get([SETTINGS_KEY]);
  const parsed = stored[SETTINGS_KEY] as Partial<TradeSettings> | undefined;
  return normalizeSettings(parsed);
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

export async function loadExtensionPresets(): Promise<TradePresetState> {
  const chromeStorage = getChromeStorage();
  if (!chromeStorage) return loadPresetStateFromLocalStorage();

  const stored = await chromeStorage.get([PRESETS_KEY]);
  return normalizePresetState(stored[PRESETS_KEY]);
}

export async function saveExtensionPresets(state: TradePresetState) {
  const normalized = normalizePresetState(state);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(normalized));
  await getChromeStorage()?.set({ [PRESETS_KEY]: normalized });
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
  return {
    ...merged,
    buyAmounts: normalizeNumberList(merged.buyAmounts, defaultSettings.buyAmounts, 4),
    sellPercents: normalizeNumberList(merged.sellPercents, defaultSettings.sellPercents, 4).map((value) => Math.min(100, value)),
    selectedBuyAmount: positiveNumber(merged.selectedBuyAmount, defaultSettings.selectedBuyAmount),
    selectedSellPercent: Math.min(100, positiveNumber(merged.selectedSellPercent, defaultSettings.selectedSellPercent)),
    slippage: clampNumber(merged.slippage, 0, 50, defaultSettings.slippage),
    priorityFee: clampNumber(merged.priorityFee, 0, 0.1, defaultSettings.priorityFee),
    jitoTip: clampNumber(merged.jitoTip, 0, 0.1, defaultSettings.jitoTip),
    autoFee: Boolean(merged.autoFee),
    autoFeeLevel: ['normal', 'fast', 'turbo'].includes(merged.autoFeeLevel) ? merged.autoFeeLevel : defaultSettings.autoFeeLevel,
    autoFeeMax: clampNumber(merged.autoFeeMax, 0.0001, 0.1, defaultSettings.autoFeeMax),
    rpcUrl: typeof merged.rpcUrl === 'string' && merged.rpcUrl.trim() ? merged.rpcUrl.trim() : PUBLICNODE_RPC_URL,
    signerMode: ['wallet', 'local'].includes(merged.signerMode) ? merged.signerMode : defaultSettings.signerMode,
    localWalletPublicKey: typeof merged.localWalletPublicKey === 'string' ? merged.localWalletPublicKey : '',
    sendMode: ['rpc', 'jito'].includes(merged.sendMode) ? merged.sendMode : defaultSettings.sendMode,
    jitoEndpoint: typeof merged.jitoEndpoint === 'string' && merged.jitoEndpoint.trim() ? merged.jitoEndpoint.trim() : JITO_MAINNET_TRANSACTION_URL,
    jitoBundleOnly: Boolean(merged.jitoBundleOnly),
    executionMode: ['jupiter', 'pump', 'auto'].includes(merged.executionMode) ? merged.executionMode : defaultSettings.executionMode
  };
}

function loadPresetStateFromLocalStorage(): TradePresetState {
  const raw = localStorage.getItem(PRESETS_KEY);
  if (!raw) return normalizePresetState();

  try {
    return normalizePresetState(JSON.parse(raw));
  } catch {
    return normalizePresetState();
  }
}

function normalizePresetState(state?: unknown): TradePresetState {
  const candidate = state as Partial<TradePresetState> | undefined;
  const parsedPresets = Array.isArray(candidate?.presets)
    ? candidate.presets.map(normalizePreset).filter((preset): preset is TradePreset => Boolean(preset))
    : [];
  const presets = parsedPresets.length ? parsedPresets : cloneDefaultPresets();
  const requestedActive = typeof candidate?.activePresetId === 'string' ? candidate.activePresetId : '';
  const activePresetId = presets.some((preset) => preset.id === requestedActive) ? requestedActive : presets[0].id;
  return { activePresetId, presets };
}

function normalizePreset(preset: unknown): TradePreset | null {
  const candidate = preset as Partial<TradePreset> | undefined;
  if (!candidate || typeof candidate !== 'object') return null;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim().slice(0, 48) : '';
  if (!id) return null;
  const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim().slice(0, 24) : 'Preset';
  const updatedAt = Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : 0;
  return {
    id,
    name,
    settings: normalizeSettings(candidate.settings),
    updatedAt
  };
}

function cloneDefaultPresets(): TradePreset[] {
  return defaultTradePresets.map((preset) => ({
    ...preset,
    settings: { ...preset.settings }
  }));
}

export function getActiveRpcUrl(settings: TradeSettings) {
  return settings.rpcUrl;
}

function normalizeNumberList(value: unknown, fallback: number[], maxLength: number) {
  const parsed = Array.isArray(value) ? value.filter((item) => Number.isFinite(item) && item > 0).slice(0, maxLength) : [];
  return parsed.length ? parsed : fallback;
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
