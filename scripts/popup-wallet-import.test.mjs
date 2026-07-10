import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('popup keeps the fast Robinhood main-wallet import flow', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/popup.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="wallet-import"/);
  assert.match(html, /id="wallet-private-key"/);
  assert.doesNotMatch(html, /vault-password|type="password"/);
  assert.doesNotMatch(script, /TRENCH_EVM_VAULT_SETUP|TRENCH_EVM_VAULT_UNLOCK|TRENCH_EVM_VAULT_LOCK/);
  assert.match(script, /TRENCH_EVM_ACCOUNT_IMPORT/);
  assert.match(script, /TRENCH_EVM_ACCOUNT_SET_ACTIVE/);
});
