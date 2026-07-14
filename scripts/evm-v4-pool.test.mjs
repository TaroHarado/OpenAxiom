import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters } from 'viem';
import { resolveNativeV4Route } from '../src/evmV4Pool.ts';

const ZERO = '0x0000000000000000000000000000000000000000';
const OIL = '0x1360caeb5ba22320ed763622c92f31ed3a36518a';
const ROUTER = '0xed49c8990fbe4df6f356a5f061b13bb9efb9a89c';

test('resolves a token-provided native ETH V4 router from its confirmed pool key', async () => {
  const poolKey = encodeAbiParameters([{
    type: 'tuple',
    components: [
      { type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' },
    ],
  }], [[ZERO, OIL, 20_000, 200, ZERO]]);

  const route = await resolveNativeV4Route(ZERO, OIL, async (to, data) => {
    if (to === OIL && data === '0x61d027b3') return `0x${'0xc0E78670959d544468970B020E9D2062eE8dF22C'.slice(2).padStart(64, '0')}`;
    if (to === '0xc0e78670959d544468970b020e9d2062ee8df22c' && data === '0x556fe775') return `0x${OIL.slice(2).padStart(64, '0')}`;
    if (to === '0xc0e78670959d544468970b020e9d2062ee8df22c' && data === '0xc31c9c07') return `0x${ROUTER.slice(2).padStart(64, '0')}`;
    if (to === ROUTER && data === '0x182148ef') return poolKey;
    throw new Error('Unexpected call');
  });

  assert.deepEqual(route, { type: 'native-v4', router: ROUTER, fee: 20_000, tickSpacing: 200, hooks: ZERO });
});

test('rejects a token router whose pool key does not buy the requested token with native ETH', async () => {
  const poolKey = encodeAbiParameters([{
    type: 'tuple',
    components: [
      { type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' },
    ],
  }], [[ZERO, ROUTER, 20_000, 200, ZERO]]);

  assert.equal(await resolveNativeV4Route(ZERO, OIL, async (_to, data) => (
    data === '0x61d027b3' ? `0x${'0xc0E78670959d544468970B020E9D2062eE8dF22C'.slice(2).padStart(64, '0')}`
      : data === '0x556fe775' ? `0x${OIL.slice(2).padStart(64, '0')}`
      : data === '0xc31c9c07' ? `0x${ROUTER.slice(2).padStart(64, '0')}`
        : poolKey
  )), null);
});
