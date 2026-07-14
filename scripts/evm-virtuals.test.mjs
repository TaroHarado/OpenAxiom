import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOutputFee, quoteConstantProductExactInput, quoteVirtualsBuy, quoteVirtualsSell } from '../src/evmVirtuals.ts';

test('quotes the verified Virtuals pool with a nonzero minimum output', () => {
  const virtualIn = 379_553_339_500_071_462n;
  const tokenReserve = 999_833_463_873_562_088_354_207_946n;
  const virtualReserve = 8_501_885_027_745_534_078_976n;
  const quote = quoteConstantProductExactInput(virtualIn, virtualReserve, tokenReserve, 100);

  assert.equal(quote, 44_187_685_879_266_704_186_703n);
  assert.ok((quote * 7_000n) / 10_000n > 0n);
});

test('applies the router fee to the exact input before the constant-product quote', () => {
  assert.equal(quoteConstantProductExactInput(100n, 1_000n, 2_000n, 100), 180n);
});

test('applies protocol fees to output without losing the rounding remainder', () => {
  assert.equal(applyOutputFee(101n, 100), 100n);
});

test('replays the successful historical Virtuals BUY quote', () => {
  const quote = quoteVirtualsBuy(
    125_000_000_000_000n,
    2_598_431_225_899_038_032_076n,
    7_913_687_434_728_821_676_369_295n,
    8_500_990_000_000_000_000_000n,
    999_883_542_975_582_843_880_536_266n,
  );
  assert.equal(quote, 43_752_625_305_544_075_192_587n);
});

test('replays the successful historical Virtuals SELL quote', () => {
  const quote = quoteVirtualsSell(
    43_752_625_305_544_075_192_587n,
    999_839_790_350_277_299_805_343_679n,
    8_501_362_000_228_222_437_409n,
    7_913_687_058_971_015_391_078_983n,
    2_598_431_349_649_038_032_076n,
  );
  assert.equal(quote, 119_355_135_059_505n);
});

test('rejects unusable Virtuals pool reserves', () => {
  assert.throws(() => quoteConstantProductExactInput(1n, 0n, 10n, 100), /reserves/);
  assert.throws(() => quoteConstantProductExactInput(1n, 10n, 10n, 10_000), /fee/);
});
