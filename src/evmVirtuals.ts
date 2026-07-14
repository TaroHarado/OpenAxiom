export function quoteConstantProductExactInput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) throw new Error('Invalid Virtuals pool reserves');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error('Invalid Virtuals pool fee');
  const amountInAfterFee = amountIn * BigInt(10_000 - feeBps);
  return (amountInAfterFee * reserveOut) / (reserveIn * 10_000n + amountInAfterFee);
}

export function applyOutputFee(amountOut: bigint, feeBps: number) {
  if (amountOut < 0n) throw new Error('Invalid output amount');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error('Invalid output fee');
  return amountOut - (amountOut * BigInt(feeBps)) / 10_000n;
}

export function quoteVirtualsBuy(
  amountIn: bigint,
  wethReserve: bigint,
  virtualPairReserve: bigint,
  virtualTokenReserve: bigint,
  tokenReserve: bigint,
) {
  const routedWeth = applyOutputFee(amountIn, 100);
  const virtualOut = applyOutputFee(
    quoteConstantProductExactInput(routedWeth, wethReserve, virtualPairReserve, 30),
    100,
  );
  return quoteConstantProductExactInput(virtualOut, virtualTokenReserve, tokenReserve, 0);
}

export function quoteVirtualsSell(
  amountIn: bigint,
  tokenReserve: bigint,
  virtualTokenReserve: bigint,
  virtualPairReserve: bigint,
  wethReserve: bigint,
) {
  const virtualOut = applyOutputFee(
    quoteConstantProductExactInput(amountIn, tokenReserve, virtualTokenReserve, 0),
    100,
  );
  const wethOut = quoteConstantProductExactInput(virtualOut, virtualPairReserve, wethReserve, 30);
  return applyOutputFee(wethOut, 100);
}

export function decodeVirtualsReserves(result: string) {
  const data = result.startsWith('0x') ? result.slice(2) : result;
  if (data.length < 128) throw new Error('Invalid Virtuals reserve response');
  return [BigInt(`0x${data.slice(0, 64)}`), BigInt(`0x${data.slice(64, 128)}`)] as const;
}
