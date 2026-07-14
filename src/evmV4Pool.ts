import { decodeAbiParameters } from 'viem';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const KNOWN_NATIVE_V4_TREASURIES: Record<string, string> = {
  '0x1360caeb5ba22320ed763622c92f31ed3a36518a': '0xc0e78670959d544468970b020e9d2062ee8df22c',
};

const POOL_KEY_PARAMETERS = [{
  name: 'poolKey',
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
}] as const;

export type NativeV4Route = {
  type: 'native-v4';
  router: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

export async function resolveNativeV4Route(
  tokenIn: string,
  tokenOut: string,
  call: (to: string, data: string) => Promise<string>,
): Promise<NativeV4Route | null> {
  const treasury = KNOWN_NATIVE_V4_TREASURIES[tokenOut.toLowerCase()]
    ?? await call(tokenOut, '0x61d027b3').then((result) => `0x${result.slice(-40)}`).catch(() => null);
  if (!treasury || treasury.toLowerCase() === ZERO_ADDRESS) return null;
  const treasuryOil = await call(treasury, '0x556fe775').then((result) => `0x${result.slice(-40)}`).catch(() => null);
  if (treasuryOil?.toLowerCase() !== tokenOut.toLowerCase()) return null;
  const router = await call(treasury, '0xc31c9c07').then((result) => `0x${result.slice(-40)}`).catch(() => null);
  if (!router || router.toLowerCase() === ZERO_ADDRESS) return null;

  const result = await call(router, '0x182148ef').catch(() => null);
  if (!result) return null;
  const [poolKey] = decodeAbiParameters(POOL_KEY_PARAMETERS, result as `0x${string}`);
  if (
    tokenIn.toLowerCase() !== ZERO_ADDRESS
    || poolKey.currency0.toLowerCase() !== ZERO_ADDRESS
    || poolKey.currency1.toLowerCase() !== tokenOut.toLowerCase()
  ) return null;

  return {
    type: 'native-v4',
    router,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: poolKey.hooks,
  };
}
