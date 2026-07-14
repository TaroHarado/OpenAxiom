import { decodeAbiParameters } from 'viem';

const DOPPLER_HOOK_INITIALIZER = '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544';
const GET_STATE_SELECTOR = '0x1bab58f5';

const DOPPLER_STATE_PARAMETERS = [
  { name: 'numeraire', type: 'address' },
  { name: 'totalTokensOnBondingCurve', type: 'uint256' },
  { name: 'dopplerHook', type: 'address' },
  { name: 'graduationDopplerHookCalldata', type: 'bytes' },
  { name: 'status', type: 'uint8' },
  {
    name: 'poolKey',
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
  { name: 'farTick', type: 'int24' },
] as const;

export type DopplerRoute = {
  type: 'doppler';
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
};

export type DopplerPoolKey = DopplerRoute['poolKey'];

export async function resolveDopplerRoute(
  tokenIn: string,
  tokenOut: string,
  call: (to: string, data: string) => Promise<string>,
): Promise<DopplerRoute | null> {
  const data = `${GET_STATE_SELECTOR}${tokenOut.slice(2).toLowerCase().padStart(64, '0')}`;
  const result = await call(DOPPLER_HOOK_INITIALIZER, data);
  const state = decodeAbiParameters(DOPPLER_STATE_PARAMETERS, result as `0x${string}`);
  const numeraire = state[0].toLowerCase();
  const status = state[4];
  const poolKey = state[5];
  const currencies = [poolKey.currency0.toLowerCase(), poolKey.currency1.toLowerCase()];

  if (
    (status !== 1 && status !== 2)
    || numeraire !== tokenIn.toLowerCase()
    || !currencies.includes(tokenIn.toLowerCase())
    || !currencies.includes(tokenOut.toLowerCase())
    || poolKey.hooks.toLowerCase() !== DOPPLER_HOOK_INITIALIZER.toLowerCase()
  ) {
    return null;
  }

  return {
    type: 'doppler',
    poolKey: {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks,
    },
  };
}

export async function resolveDopplerPoolKey(
  token: string,
  call: (to: string, data: string) => Promise<string>,
): Promise<DopplerPoolKey | null> {
  const data = `${GET_STATE_SELECTOR}${token.slice(2).toLowerCase().padStart(64, '0')}`;
  const result = await call(DOPPLER_HOOK_INITIALIZER, data);
  const state = decodeAbiParameters(DOPPLER_STATE_PARAMETERS, result as `0x${string}`);
  const poolKey = state[5];
  const currencies = [poolKey.currency0.toLowerCase(), poolKey.currency1.toLowerCase()];

  if (
    (state[4] !== 1 && state[4] !== 2)
    || !currencies.includes(token.toLowerCase())
    || poolKey.hooks.toLowerCase() !== DOPPLER_HOOK_INITIALIZER.toLowerCase()
  ) {
    return null;
  }

  return {
    currency0: poolKey.currency0,
    currency1: poolKey.currency1,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: poolKey.hooks,
  };
}
