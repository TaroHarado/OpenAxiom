import assert from 'node:assert/strict';
import test from 'node:test';
import { selectBestV3Pool } from '../src/evmV3Pool.ts';

test('keeps an initialized V3 pool with zero active liquidity for swap simulation', () => {
  assert.deepEqual(
    selectBestV3Pool([{ pool: '0xa7956100d35a86f0a389e6af607bc9459acfc124', fee: 10000, liquidity: 0n }]),
    { pool: '0xa7956100d35a86f0a389e6af607bc9459acfc124', fee: 10000 },
  );
});

test('prefers the pool with the highest active liquidity', () => {
  assert.deepEqual(
    selectBestV3Pool([
      { pool: '0x0000000000000000000000000000000000000001', fee: 500, liquidity: 0n },
      { pool: '0x0000000000000000000000000000000000000002', fee: 3000, liquidity: 10n },
    ]),
    { pool: '0x0000000000000000000000000000000000000002', fee: 3000 },
  );
});
