import { performance } from 'node:perf_hooks';

const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const VIRTUALS_FACTORY = '0xfc2e4da3edb2e18100473339c763705d263d20a9';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const VIRTUAL = '0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31';
const ZERO = '0x0000000000000000000000000000000000000000';
const DOPPLER_INITIALIZER = '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544';
const FEE_TIERS = [100, 500, 3000, 10000];
const RUNS = Number.parseInt(process.env.RUNS ?? '3', 10);

const TOKENS = [
  ['Flap', '0x342a2e3fe8b3f70189216910d936316294df7777'],
  ['Klick', '0x693d17bd4fc192415f7678548ae3c807873f7857'],
  ['Pons', '0x552b9689488d8ae82f733d10e2ff7ea5dd3ba2b8'],
  ['Ape.stoke', '0x0152fa93e3dc19f8b71693fb797ce232d064812c'],
  ['Bankr', '0x3a7059cc8ea61aaa5418405f509ad32a9a780ba3'],
  ['Freedhood', '0xc984e7a2f7b5e8a4a37f9cd00d374bc9dd44bba3'],
  ['what IF', '0x43a74ecf28607bfa8edc40e7a8e83f6456ac42fd'],
];

let rpcId = 0;

function word(value) {
  return value.replace(/^0x/, '').toLowerCase().padStart(64, '0');
}

function getPoolData(tokenA, tokenB, fee) {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
  return `0x1698ee82${word(token0)}${word(token1)}${fee.toString(16).padStart(64, '0')}`;
}

function getPairData(tokenA, tokenB) {
  return `0xe6a43905${word(tokenA)}${word(tokenB)}`;
}

function getStateData(token) {
  return `0x1bab58f5${word(token)}`;
}

function decodeAddress(result) {
  return `0x${result.slice(-40)}`.toLowerCase();
}

function decodeDopplerState(result) {
  const raw = result.slice(2);
  const addressAt = (index) => `0x${raw.slice(index * 64 + 24, (index + 1) * 64)}`.toLowerCase();
  const status = Number.parseInt(raw.slice(4 * 64, 5 * 64), 16);
  return {
    active: status === 1 || status === 2,
    status,
    numeraire: addressAt(0),
    currency0: addressAt(5),
    currency1: addressAt(6),
    hooks: addressAt(9),
  };
}

function decodeString(result) {
  if (!result || result === '0x') return '';
  const raw = result.slice(2);
  try {
    const offset = Number.parseInt(raw.slice(0, 64), 16) * 2;
    const length = Number.parseInt(raw.slice(offset, offset + 64), 16) * 2;
    return Buffer.from(raw.slice(offset + 64, offset + 64 + length), 'hex').toString('utf8').replaceAll('\0', '').trim();
  } catch {
    return Buffer.from(raw.slice(0, 64).replace(/00+$/, ''), 'hex').toString('utf8').trim();
  }
}

async function rpc(method, params) {
  const startedAt = performance.now();
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const payload = await response.json();
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (!response.ok || payload.error) {
    throw new Error(`${method} failed after ${durationMs} ms: ${payload.error?.message ?? response.statusText}`);
  }
  return { result: payload.result, durationMs };
}

async function ethCall(to, data, block = 'latest') {
  return rpc('eth_call', [{ to, data }, block]);
}

async function inspectToken(label, token, block) {
  const metadataStartedAt = performance.now();
  const [symbolCall, nameCall, codeCall] = await Promise.all([
    ethCall(token, '0x95d89b41', block),
    ethCall(token, '0x06fdde03', block),
    rpc('eth_getCode', [token, block]),
  ]);

  const probes = await Promise.all([
    ...[WETH, USDG, VIRTUAL].flatMap((base) => FEE_TIERS.map(async (fee) => {
      const call = await ethCall(V3_FACTORY, getPoolData(base, token, fee), block);
      return { kind: 'v3', base, fee, address: decodeAddress(call.result), lookupMs: call.durationMs };
    })),
    ethCall(VIRTUALS_FACTORY, getPairData(VIRTUAL, token), block).then((call) => ({
      kind: 'virtuals', base: VIRTUAL, fee: null, address: decodeAddress(call.result), lookupMs: call.durationMs,
    })),
    ethCall(DOPPLER_INITIALIZER, getStateData(token), block).then((call) => ({
      kind: 'doppler', base: null, fee: null, address: ZERO, lookupMs: call.durationMs,
      state: decodeDopplerState(call.result),
    })),
  ]);

  const pools = [];
  for (const probe of probes) {
    if (probe.kind === 'doppler') continue;
    if (probe.address === ZERO) continue;
    const liquidityCall = await ethCall(probe.address, '0x1a686502', block);
    pools.push({ ...probe, liquidity: BigInt(liquidityCall.result).toString(), liquidityMs: liquidityCall.durationMs });
  }

  return {
    requestedLabel: label,
    address: token,
    symbol: decodeString(symbolCall.result),
    name: decodeString(nameCall.result),
    bytecodeBytes: Math.max(0, (codeCall.result.length - 2) / 2),
    metadataMs: Math.round((performance.now() - metadataStartedAt) * 10) / 10,
    pools,
    doppler: probes.find((probe) => probe.kind === 'doppler'),
    route: pools.some((pool) => pool.kind === 'v3' && pool.base === WETH)
      ? 'weth-v3'
      : probes.some((probe) => probe.kind === 'doppler'
        && probe.state.active
        && probe.state.numeraire === WETH
        && [probe.state.currency0, probe.state.currency1].includes(token.toLowerCase())
        && probe.state.hooks === DOPPLER_INITIALIZER.toLowerCase())
        ? 'doppler-v4'
        : pools.length > 0 ? pools[0].kind : 'unknown',
  };
}

async function run() {
  if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 20) throw new Error('RUNS must be an integer from 1 to 20');
  const chainCall = await rpc('eth_chainId', []);
  const blockCall = await rpc('eth_blockNumber', []);
  const block = blockCall.result;
  const report = {
    generatedAt: new Date().toISOString(),
    rpc: RPC_URL,
    chainId: Number.parseInt(chainCall.result, 16),
    block: Number.parseInt(block, 16),
    runs: [],
  };

  for (let runNumber = 1; runNumber <= RUNS; runNumber += 1) {
    const startedAt = performance.now();
    const tokens = await Promise.all(TOKENS.map(([label, token]) => inspectToken(label, token, block)));
    report.runs.push({
      run: runNumber,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      tokens,
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
