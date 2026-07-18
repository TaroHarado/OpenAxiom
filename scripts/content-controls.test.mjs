import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isInvalidExtensionContext,
  selectQuickBuyAmount,
  stopOverlayEvent,
} from '../src/contentControls.ts';

test('stops overlay events before they reach the host page', () => {
  let stopped = 0;

  stopOverlayEvent({ stopPropagation: () => { stopped += 1; } });

  assert.equal(stopped, 1);
});

test('updates only the selected quick-buy amount for a positive value', () => {
  const settings = { buyAmounts: [0.001, 0.01], selectedBuyAmount: 0.001, slippage: 2 };

  assert.deepEqual(selectQuickBuyAmount(settings, 0.01), {
    buyAmounts: [0.001, 0.01],
    selectedBuyAmount: 0.01,
    slippage: 2,
  });
  assert.equal(selectQuickBuyAmount(settings, 0), settings);
});

test('recognizes extension lifecycle messaging failures', () => {
  assert.equal(isInvalidExtensionContext(new Error('Extension context invalidated.')), true);
  assert.equal(isInvalidExtensionContext(new Error('Could not establish connection. Receiving end does not exist.')), true);
  assert.equal(isInvalidExtensionContext(new Error('The message port closed before a response was received.')), true);
  assert.equal(isInvalidExtensionContext(new Error('Swap simulation reverted')), false);
});
