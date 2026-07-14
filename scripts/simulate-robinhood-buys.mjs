import { createPublicClient, defineChain, encodeFunctionData, formatUnits, http, parseEther } from 'viem';

const RH_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FROM = process.env.RH_TEST_FROM || '0xe90656ce53062b537bbf40b753a1bafcfa2e5e0a';
const BUY_AMOUNT = parseEther(process.env.RH_BUY_ETH || '0.00001');
const SLIPPAGE_BPS = BigInt(process.env.RH_SLIPPAGE_BPS || '500');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const FLAP_PORTAL = '0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09';
const SWAP_ROUTER_02 = '0xcaf681a66d020601342297493863e78c959e5cb2';
const V4_QUOTER = '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94';
const CUSTOM_ROUTER = '0x65050A9b7E5075A2bA5cED7b1b64EE66262c40Dc';
const V4_POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const ALLOWANCE_HOLDER = '0x0000000000001fF3684f28c67538d4D072C22734';
const ROBINHOOD_SETTLER = '0xe72688F7d25D7318B9A81F21EdDa640CA948c83B';
const NATIVE_TOKEN_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const DART_HOOK = '0x745d717620052a97a22dEEE2e5Eba59583f3e0CC';
const PULL_HOOK = '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544';
const DART_V4_FILLS = '0x271000000000000000000000000000000001000276a401693d17bd4fc192415f7678548ae3c807873f78570000000000c8745d717620052a97a22deee2e5eba59583f3e0cc000000';

const tokens = [
  { label: 'Flap', symbol: 'UFC', address: '0x342a2e3fe8b3f70189216910d936316294df7777', route: 'flap' },
  { label: 'Klick', symbol: 'DART', address: '0x693d17bd4fc192415f7678548ae3c807873f7857', route: 'dart' },
  { label: 'Pons', symbol: 'AROUNSHARK', address: '0x552b9689488d8ae82f733d10e2ff7ea5dd3ba2b8', route: 'v3', fee: 10000 },
  { label: 'Ape.stoke', symbol: 'APEMAN', address: '0x0152fa93e3dc19f8b71693fb797ce232d064812c', route: 'v3', fee: 10000 },
  { label: 'Bankr', symbol: 'PULL', address: '0x3a7059cc8ea61aaa5418405f509ad32a9a780ba3', route: 'pull' },
  { label: 'Freed', symbol: 'FREED', address: '0xc984e7a2f7b5e8a4a37f9cd00d374bc9dd44bba3', route: 'doppler' },
  { label: 'what IF', symbol: 'IF', address: '0x43a74ecf28607bfa8edc40e7a8e83f6456ac42fd', route: 'v3', fee: 10000 },
];

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC] } },
});

const client = createPublicClient({ chain, transport: http(RH_RPC) });

const flapQuoteAbi = [{
  name: 'quoteExactInput', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'inputToken', type: 'address' }, { name: 'outputToken', type: 'address' }, { name: 'inputAmount', type: 'uint256' },
  ]}],
  outputs: [{ name: 'outputAmount', type: 'uint256' }],
}];

const flapSwapAbi = [{
  name: 'swapExactInput', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'inputToken', type: 'address' }, { name: 'outputToken', type: 'address' },
    { name: 'inputAmount', type: 'uint256' }, { name: 'minOutputAmount', type: 'uint256' }, { name: 'permitData', type: 'bytes' },
  ]}],
  outputs: [{ name: 'outputAmount', type: 'uint256' }],
}];

const exactInputSingleAbi = [{
  name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' },
    { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ]}],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}];

const v4QuoterAbi = [{
  name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'poolKey', type: 'tuple', components: [
      { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
    ]},
    { name: 'zeroForOne', type: 'bool' }, { name: 'exactAmount', type: 'uint128' }, { name: 'hookData', type: 'bytes' },
  ]}],
  outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
}];

const customRouterAbi = [{
  name: 'swap', type: 'function', stateMutability: 'payable',
  inputs: [
    { name: 'descs', type: 'tuple[]', components: [
      { name: 'routeType', type: 'uint8' }, { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'pool', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' }, { name: 'hookData', type: 'bytes' }, { name: 'extraAddress', type: 'address' },
      { name: 'poolId', type: 'bytes32' },
    ]},
    { name: 'receiver', type: 'address' }, { name: 'amountIn', type: 'uint256' },
    { name: 'amountOutMin', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ],
  outputs: [],
}];

const allowanceHolderAbi = [{
  name: 'exec', type: 'function', stateMutability: 'payable',
  inputs: [
    { name: 'operator', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'target', type: 'address' }, { name: 'data', type: 'bytes' },
  ],
  outputs: [],
}];

const settlerExecuteAbi = [{
  name: 'execute', type: 'function', stateMutability: 'payable',
  inputs: [
    { name: 'slippage', type: 'tuple', components: [
      { name: 'recipient', type: 'address' }, { name: 'buyToken', type: 'address' }, { name: 'minAmountOut', type: 'uint256' },
    ]},
    { name: 'actions', type: 'bytes[]' }, { name: 'zidAndAffiliate', type: 'bytes32' },
  ],
  outputs: [],
}];

const settlerActionsAbi = [
  { name: 'NATIVE_CHECK', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'deadline', type: 'uint256' }, { name: 'msgValue', type: 'uint256' }], outputs: [] },
];

const minOut = (quote) => (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;

function encodeUniswapV4Action() {
  const payloadAbi = [{ name: 'UNISWAPV4_PAYLOAD', type: 'function', stateMutability: 'nonpayable', inputs: [
    { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bool' },
    { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'uint256' },
  ], outputs: [] }];
  const payload = encodeFunctionData({
    abi: payloadAbi,
    functionName: 'UNISWAPV4_PAYLOAD',
    args: [ROBINHOOD_SETTLER, NATIVE_TOKEN_SENTINEL, 10_000n, false, 2n, 18_446_744_073_709_551_557n, DART_V4_FILLS, 0n],
  });
  return `0xaf72634f${payload.slice(10)}`;
}

async function simulateFlap(token) {
  const quote = await client.simulateContract({
    account: FROM,
    address: FLAP_PORTAL,
    abi: flapQuoteAbi,
    functionName: 'quoteExactInput',
    args: [{ inputToken: ZERO_ADDRESS, outputToken: token.address, inputAmount: BUY_AMOUNT }],
  });
  const minimum = minOut(quote.result);
  const sim = await client.simulateContract({
    account: FROM,
    address: FLAP_PORTAL,
    abi: flapSwapAbi,
    functionName: 'swapExactInput',
    args: [{ inputToken: ZERO_ADDRESS, outputToken: token.address, inputAmount: BUY_AMOUNT, minOutputAmount: minimum, permitData: '0x' }],
    value: BUY_AMOUNT,
  });
  return { target: FLAP_PORTAL, value: BUY_AMOUNT, quote: quote.result, minOut: minimum, result: sim.result };
}

async function simulateV3(token) {
  const baseArgs = { tokenIn: WETH, tokenOut: token.address, fee: token.fee, recipient: FROM, amountIn: BUY_AMOUNT, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n };
  const quote = await client.simulateContract({ account: FROM, address: SWAP_ROUTER_02, abi: exactInputSingleAbi, functionName: 'exactInputSingle', args: [baseArgs], value: BUY_AMOUNT });
  const minimum = minOut(quote.result);
  const sim = await client.simulateContract({ account: FROM, address: SWAP_ROUTER_02, abi: exactInputSingleAbi, functionName: 'exactInputSingle', args: [{ ...baseArgs, amountOutMinimum: minimum }], value: BUY_AMOUNT });
  return { target: SWAP_ROUTER_02, value: BUY_AMOUNT, quote: quote.result, minOut: minimum, result: sim.result };
}

async function simulatePull(token) {
  const poolKey = { currency0: WETH, currency1: token.address, fee: 8_388_608, tickSpacing: 200, hooks: PULL_HOOK };
  const quote = await client.simulateContract({ account: FROM, address: V4_QUOTER, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey, zeroForOne: true, exactAmount: BUY_AMOUNT, hookData: '0x' }] });
  const minimum = minOut(quote.result[0]);
  const sim = await client.simulateContract({
    account: FROM,
    address: CUSTOM_ROUTER,
    abi: customRouterAbi,
    functionName: 'swap',
    args: [[{ routeType: 2, tokenIn: WETH, tokenOut: token.address, pool: ZERO_ADDRESS, fee: 8_388_608, tickSpacing: 200, hooks: PULL_HOOK, hookData: '0x', extraAddress: V4_POOL_MANAGER, poolId: ZERO_BYTES32 }], ZERO_ADDRESS, BUY_AMOUNT, minimum, 0n],
    value: BUY_AMOUNT,
  });
  return { target: CUSTOM_ROUTER, value: BUY_AMOUNT, quote: quote.result[0], minOut: minimum, result: sim.result };
}

async function simulateDart(token) {
  const poolKey = { currency0: ZERO_ADDRESS, currency1: token.address, fee: 0, tickSpacing: 200, hooks: DART_HOOK };
  const quote = await client.simulateContract({ account: FROM, address: V4_QUOTER, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey, zeroForOne: true, exactAmount: BUY_AMOUNT, hookData: '0x' }] });
  const minimum = minOut(quote.result[0]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const actions = [
    encodeFunctionData({ abi: settlerActionsAbi, functionName: 'NATIVE_CHECK', args: [deadline, BUY_AMOUNT] }),
    encodeUniswapV4Action(),
  ];
  const settlerData = encodeFunctionData({ abi: settlerExecuteAbi, functionName: 'execute', args: [{ recipient: FROM, buyToken: token.address, minAmountOut: minimum }, actions, ZERO_BYTES32] });
  const sim = await client.simulateContract({
    account: FROM,
    address: ALLOWANCE_HOLDER,
    abi: allowanceHolderAbi,
    functionName: 'exec',
    args: [ROBINHOOD_SETTLER, ZERO_ADDRESS, BUY_AMOUNT, ROBINHOOD_SETTLER, settlerData],
    value: BUY_AMOUNT,
  });
  return { target: ALLOWANCE_HOLDER, value: BUY_AMOUNT, quote: quote.result[0], minOut: minimum, result: sim.result };
}

const simulators = { flap: simulateFlap, v3: simulateV3, pull: simulatePull, dart: simulateDart, doppler: simulatePull };

console.log(`from=${FROM}`);
console.log(`buyEth=${formatUnits(BUY_AMOUNT, 18)} slippageBps=${SLIPPAGE_BPS}`);

let failed = 0;
for (const token of tokens) {
  const started = performance.now();
  try {
    const result = await simulators[token.route](token);
    const gas = await client.estimateContractGas({
      account: FROM,
      address: result.target,
      abi: token.route === 'flap' ? flapSwapAbi : token.route === 'v3' ? exactInputSingleAbi : token.route === 'dart' ? allowanceHolderAbi : customRouterAbi,
      functionName: token.route === 'flap' ? 'swapExactInput' : token.route === 'v3' ? 'exactInputSingle' : token.route === 'dart' ? 'exec' : 'swap',
      args: result.requestArgs ?? [],
      value: result.value,
    }).catch(() => null);
    console.log(`OK ${token.label} ${token.symbol} ${token.address}`);
    console.log(`  route=${token.route} target=${result.target} valueWei=${result.value}`);
    console.log(`  quote=${result.quote} minOut=${result.minOut} gas=${gas ?? 'n/a'} ms=${Math.round(performance.now() - started)}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${token.label} ${token.symbol} ${token.address}`);
    console.log(`  route=${token.route} error=${error.shortMessage || error.message}`);
  }
}

process.exitCode = failed === 0 ? 0 : 1;
