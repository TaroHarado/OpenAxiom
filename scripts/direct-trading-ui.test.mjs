import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all Robinhood trade entry points execute without confirmation dialogs', async () => {
  const sources = await Promise.all([
    '../src/content.tsx',
    '../src/options.tsx',
    '../src/storage.ts',
    '../src/trenches.tsx',
    '../src/types.ts',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));

  for (const source of sources) {
    assert.doesNotMatch(source, /confirmPending|settings\.confirmation|confirmation:/);
    assert.doesNotMatch(source, /window\.confirm\(`(?:Buy|Sell)/);
  }
});

test('all Robinhood trade buttons require a trusted browser event', async () => {
  const [overlay, trenches] = await Promise.all([
    readFile(new URL('../src/content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/trenches.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(overlay, /event\.nativeEvent\.isTrusted/);
  assert.match(trenches, /event\.nativeEvent\.isTrusted/);
});

test('GMGN visibility uses a disposable controller and safe card flow', async () => {
  const overlay = await readFile(new URL('../src/content.tsx', import.meta.url), 'utf8');

  assert.match(overlay, /showOnGmgn/);
  assert.match(overlay, /root\.unmount\(\)/);
  assert.match(overlay, /observer\.disconnect\(\)/);
  assert.match(overlay, /removeGmgnQuickBuyControls/);
  assert.doesNotMatch(overlay, /position:\s*absolute;[\s\S]{0,300}GMGN_CONTROL_CLASS/);
  assert.doesNotMatch(overlay, /card\.style\.position\s*=\s*['"]relative['"]/);
});

test('trade presets use four independent numeric fields', async () => {
  const [overlay, options] = await Promise.all([
    readFile(new URL('../src/content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/options.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(overlay, /function PresetFields/);
  assert.match(options, /function PresetEditor/);
  assert.doesNotMatch(overlay, /parseNumberList/);
  assert.doesNotMatch(options, /parseNumberList/);
  assert.doesNotMatch(options, /values\.join\(['"] ["']\)/);
});

test('GMGN SPA reinjection restores styles and only observes routes while enabled', async () => {
  const overlay = await readFile(new URL('../src/content.tsx', import.meta.url), 'utf8');

  assert.match(overlay, /if \(!isGmgnPage\(\)\) return/);
  assert.match(overlay, /settings\?\.showOnGmgn/);
  assert.match(overlay, /new MutationObserver\(syncRoute\)/);
  assert.match(overlay, /refreshGmgnQuickBuyButtons\(\)[\s\S]{0,200}installGmgnStyle\(\)/);
});

test('Robinhood quick buys prewarm routes and return after broadcast without retrying a submission', async () => {
  const [overlay, background] = await Promise.all([
    readFile(new URL('../src/content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/background.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(overlay, /pointerenter/);
  assert.match(overlay, /TRENCH_EVM_PREWARM_ROUTE/);
  assert.match(overlay, /side: 'sell'/);
  assert.match(background, /resolveCachedSwapRoute/);
  assert.match(background, /sellBalancePromise/);
  assert.match(background, /TRENCH_EVM_PREWARM_ROUTE/);
  assert.match(background, /monitorEvmSubmission/);
  assert.match(background, /return \{ ok: true, hash, status: 'pending' \}/);
  assert.doesNotMatch(background, /sendRawTransaction[\s\S]{0,300}retryCount:\s*[1-9]/);
});

test('Robinhood balances and PnL use token decimals and snapshot every selected wallet before submission', async () => {
  const overlay = await readFile(new URL('../src/content.tsx', import.meta.url), 'utf8');

  assert.match(overlay, /fetchEvmTokenDecimals/);
  assert.match(overlay, /formatEvmTokenAmount/);
  assert.match(overlay, /Promise\.all\(accountIds\.map/);
  assert.match(overlay, /beforeBalances\.set\(accountId, balance\)/);
  assert.match(overlay, /for \(const result of batch\.results\)/);
  assert.doesNotMatch(overlay, /Number\(pair\.token\)\s*\/\s*1e18/);
  assert.doesNotMatch(overlay, /Number\(after\.token\)\s*\/\s*1e18/);
});

test('overlay stays compact while using one panel with transparent, divider-separated trading sections', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.tw-widget\s*\{[\s\S]{0,400}width:\s*312px/);
  assert.match(styles, /\.tw-widget\s*\{[\s\S]{0,400}border-radius:\s*16px/);
  assert.match(styles, /\.tw-trade\s*\{[\s\S]{0,300}background:\s*transparent/);
  assert.match(styles, /\.tw-trade\s*\{[\s\S]{0,300}border-bottom:/);
  assert.match(styles, /\.tw-status-tile \+ \.tw-status-tile\s*\{\s*border-left:/);
  assert.match(styles, /\.tw-order-row\s*\{[\s\S]{0,300}border-top:/);
  assert.match(styles, /\.tw-order-row\s*\{[\s\S]{0,300}background:\s*transparent/);
});

test('overlay synchronizes imported wallets without requiring a GMGN page reload', async () => {
  const overlay = await readFile(new URL('../src/content.tsx', import.meta.url), 'utf8');

  assert.match(overlay, /chrome\?\.storage/);
  assert.match(overlay, /trench\.evmAccounts\.v2/);
  assert.match(overlay, /window\.setInterval\(refreshEvmWallet, 5_000\)/);
  assert.match(overlay, /hasWallet: Boolean\(active\)/);
});
