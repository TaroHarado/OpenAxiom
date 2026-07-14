import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters } from 'viem';
import { resolveDopplerPoolKey, resolveDopplerRoute } from '../src/evmDoppler.ts';

const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const FREED = '0xc984E7a2F7b5e8a4a37f9Cd00D374bC9dd44BBA3';
const INITIALIZER = '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544';
const DOPPLER_HOOK = '0x6f02324d20CC679d0E585290CAa6b16baCbC0F77';

const stateParameters = [
  { type: 'address' },
  { type: 'uint256' },
  { type: 'address' },
  { type: 'bytes' },
  { type: 'uint8' },
  {
    type: 'tuple',
    components: [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
  },
  { type: 'int24' },
];

test('resolves any initialized Doppler V4 WETH token without an address allowlist', async () => {
  const encodedState = encodeAbiParameters(stateParameters, [
    WETH,
    85_000_000_000n * 10n ** 18n,
    DOPPLER_HOOK,
    '0x',
    2,
    [WETH, FREED, 8_388_608, 200, INITIALIZER],
    -887000,
  ]);

  const route = await resolveDopplerRoute(WETH, FREED, async () => encodedState);

  assert.deepEqual(route, {
    type: 'doppler',
    poolKey: {
      currency0: WETH,
      currency1: FREED,
      fee: 8_388_608,
      tickSpacing: 200,
      hooks: INITIALIZER,
    },
  });
});

test('ignores an uninitialized token', async () => {
  const zero = '0x0000000000000000000000000000000000000000';
  const encodedState = encodeAbiParameters(stateParameters, [
    zero,
    0n,
    zero,
    '0x',
    0,
    [zero, zero, 0, 0, zero],
    0,
  ]);

  assert.equal(await resolveDopplerRoute(WETH, FREED, async () => encodedState), null);
});

test('resolves an active USDG bonding-curve pool key for native buy routing', async () => {
  const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
  const encodedState = encodeAbiParameters(stateParameters, [
    USDG,
    100_000_000n * 10n ** 18n,
    DOPPLER_HOOK,
    '0x',
    1,
    [USDG, FREED, 10_000, 200, INITIALIZER],
    -887000,
  ]);

  assert.deepEqual(await resolveDopplerPoolKey(FREED, async () => encodedState), {
    currency0: USDG,
    currency1: FREED,
    fee: 10_000,
    tickSpacing: 200,
    hooks: INITIALIZER,
  });
});

test('rejects a non-Doppler hook even when a token appears in the pool key', async () => {
  const encodedState = encodeAbiParameters(stateParameters, [
    WETH,
    1n,
    DOPPLER_HOOK,
    '0x',
    1,
    [WETH, FREED, 10_000, 200, '0x0000000000000000000000000000000000000001'],
    0,
  ]);

  assert.equal(await resolveDopplerPoolKey(FREED, async () => encodedState), null);
});
