export function stopOverlayEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function selectQuickBuyAmount<T extends { selectedBuyAmount: number }>(settings: T, amount: number): T {
  if (!Number.isFinite(amount) || amount <= 0) return settings;
  return { ...settings, selectedBuyAmount: amount };
}

export function isInvalidExtensionContext(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated|receiving end does not exist|message port closed/i.test(message);
}
