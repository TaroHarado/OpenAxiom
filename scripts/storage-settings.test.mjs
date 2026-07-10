import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, loadSettings, SETTINGS_KEY } from '../src/storage.ts';

test('purges removed fields when loading legacy settings', () => {
  const writes = [];
  const legacy = JSON.stringify({
    ...defaultSettings,
    obsoleteEndpoint: 'https://legacy.invalid',
    obsoleteMode: 'legacy',
    obsoleteFee: 0.01,
  });

  globalThis.localStorage = {
    getItem: (key) => key === SETTINGS_KEY ? legacy : null,
    setItem: (key, value) => writes.push([key, value]),
  };

  assert.deepEqual(loadSettings(), defaultSettings);
  assert.deepEqual(writes, [[SETTINGS_KEY, JSON.stringify(defaultSettings)]]);
});

test('does not rewrite settings that are already normalized', () => {
  const writes = [];
  const serialized = JSON.stringify(defaultSettings);

  globalThis.localStorage = {
    getItem: (key) => key === SETTINGS_KEY ? serialized : null,
    setItem: (key, value) => writes.push([key, value]),
  };

  assert.deepEqual(loadSettings(), defaultSettings);
  assert.deepEqual(writes, []);
});

test('adds the GMGN visibility default to legacy settings', () => {
  const writes = [];
  const { showOnGmgn: _showOnGmgn, ...legacySettings } = defaultSettings;
  const serialized = JSON.stringify(legacySettings);

  globalThis.localStorage = {
    getItem: (key) => key === SETTINGS_KEY ? serialized : null,
    setItem: (key, value) => writes.push([key, value]),
  };

  assert.equal(loadSettings().showOnGmgn, true);
  assert.deepEqual(writes, [[SETTINGS_KEY, JSON.stringify(defaultSettings)]]);
});

test('preserves an explicit hidden GMGN setting', () => {
  const writes = [];
  const hiddenSettings = { ...defaultSettings, showOnGmgn: false };

  globalThis.localStorage = {
    getItem: (key) => key === SETTINGS_KEY ? JSON.stringify(hiddenSettings) : null,
    setItem: (key, value) => writes.push([key, value]),
  };

  assert.deepEqual(loadSettings(), hiddenSettings);
  assert.deepEqual(writes, []);
});

test('fills legacy preset lists to four values and selects a visible amount', () => {
  const legacySettings = {
    ...defaultSettings,
    buyAmounts: [0.01, 0.02],
    sellPercents: [25],
    selectedBuyAmount: 9,
    selectedSellPercent: 90,
  };

  globalThis.localStorage = {
    getItem: (key) => key === SETTINGS_KEY ? JSON.stringify(legacySettings) : null,
    setItem: () => {},
  };

  const normalized = loadSettings();
  assert.deepEqual(normalized.buyAmounts, [0.01, 0.02, 2, 5]);
  assert.deepEqual(normalized.sellPercents, [25, 30, 70, 100]);
  assert.equal(normalized.selectedBuyAmount, 0.01);
  assert.equal(normalized.selectedSellPercent, 25);
});
