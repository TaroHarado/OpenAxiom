import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SELL approvals preserve the exact-amount allowance invariant', async () => {
  const background = await readFile(new URL('../src/background.ts', import.meta.url), 'utf8');

  assert.match(background, /if \(allowance === amountIn\) return;/);
  assert.doesNotMatch(background, /if \(allowance >= amountIn\) return;/);
  assert.match(background, /args: \[spender, amountIn\]/);
});
