import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Robinhood wallet workflow has no password vault operations', async () => {
  const [options, popup, popupScript, background, types] = await Promise.all([
    readFile(new URL('../src/options.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../public/popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/popup.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/background.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/types.ts', import.meta.url), 'utf8'),
  ]);

  for (const source of [options, popup, popupScript, background, types]) {
    assert.doesNotMatch(source, /vaultPassword|Vault password|vault-password|TRENCH_EVM_VAULT_(?:SETUP|UNLOCK|LOCK)/);
  }
  assert.match(background, /trench\.evmPasswordVaultArchive\.v1/);
  assert.match(background, /getEvmDeviceKey/);
});
