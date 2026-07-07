import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { TradeRequest, TradeResponse } from './types';
import { getActiveRpcUrl, usesTrenchRouting } from './storage';
import { createJitoTipInstruction } from './jito';

const LAMPORTS_PER_SOL = 1_000_000_000;
const BASIS_POINTS = 10_000n;
const ONE_BILLION_SUPPLY = 1_000_000_000_000_000n;

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_FEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPF6wMugK4F6fiih1iTa');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');

const GLOBAL_DISCRIMINATOR = [167, 232, 232, 177, 200, 108, 114, 127];
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
const FEE_CONFIG_DISCRIMINATOR = [143, 52, 146, 187, 219, 123, 76, 155];
const BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR = [194, 171, 28, 70, 104, 77, 91, 47];
const SELL_V2_DISCRIMINATOR = [93, 246, 130, 60, 231, 233, 64, 178];
const CREATE_ATA_IDEMPOTENT_DISCRIMINATOR = 1;
const SPL_TOKEN_TRANSFER_INSTRUCTION = 3;
const TRENCH_FEE_BPS = 10n;

const STATIC_BUYBACK_FEE_RECIPIENTS = [
  '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD',
  '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7',
  'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL',
  '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR',
  '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6',
  'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL',
  '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD',
  'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW'
].map((address) => new PublicKey(address));

type PumpGlobal = {
  feeRecipient: PublicKey;
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
  feeRecipients: PublicKey[];
  reservedFeeRecipient: PublicKey;
  reservedFeeRecipients: PublicKey[];
};

type BondingCurve = {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  complete: boolean;
  creator: PublicKey;
  isMayhemMode: boolean;
  quoteMint: PublicKey;
};

type FeeConfig = {
  feeTiers: FeeTier[];
};

type FeeTier = {
  marketCapLamportsThreshold: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
};

type FeeBps = {
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
};

type PumpState = {
  connection: Connection;
  global: PumpGlobal;
  feeConfig: FeeConfig | null;
  mint: PublicKey;
  user: PublicKey;
  tokenProgram: PublicKey;
  mintSupply: bigint;
  bondingCurve: BondingCurve;
};

export async function preparePumpTrade(request: TradeRequest): Promise<TradeResponse> {
  const state = await resolvePumpState(request);

  if (state.bondingCurve.complete) {
    throw new Error('Bonding curve is complete; use Jupiter/PumpSwap route');
  }

  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeToMicroLamports(request.settings.priorityFee) })
  ];
  const jitoTipInstruction = createJitoTipInstruction(state.user, request.settings);
  if (jitoTipInstruction) instructions.push(jitoTipInstruction);

  if (request.side === 'buy') {
    const grossQuoteIn = solToLamports(request.amount);
    const feeLamports = calculateTrenchFee(grossQuoteIn, request);
    const spendableQuoteIn = grossQuoteIn - feeLamports;
    const expectedTokensOut = getBuyTokenAmountFromQuoteAmount(state, spendableQuoteIn);
    const minTokensOut = applySlippageFloor(expectedTokensOut, request.settings.slippage);

    if (minTokensOut <= 0n) throw new Error('Pump quote returned zero tokens');

    const associatedUser = getAssociatedTokenAddress(state.mint, state.user, state.tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(state.user, associatedUser, state.user, state.mint, state.tokenProgram));
    if (feeLamports > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: state.user, toPubkey: getTrenchFeeRecipient(request), lamports: Number(feeLamports) }));
    instructions.push(createBuyExactQuoteInV2Instruction(state, spendableQuoteIn, minTokensOut, associatedUser));

    return buildUnsignedTransaction(state.connection, state.user, instructions, feeLamports > 0n ? `Pump buy ${request.amount} SOL incl. 0.1% Trench fee` : `Pump buy ${request.amount} SOL`);
  }

  const tokenBalance = await getUserTokenBalance(state.connection, state.mint, state.user, state.tokenProgram);
  if (tokenBalance === 0n) throw new Error('No token balance to sell');

  const amount = (tokenBalance * BigInt(Math.round(request.amount))) / 100n;
  if (amount === 0n) throw new Error('Sell amount rounds to zero');

  const expectedQuoteOut = getSellQuoteAmountFromTokenAmount(state, amount);
  const minSolOutput = applySlippageFloor(expectedQuoteOut, request.settings.slippage);
  if (minSolOutput <= 0n) throw new Error('Pump quote returned zero SOL');

  const feeLamports = calculateTrenchFee(minSolOutput, request);
  if (feeLamports > 0n) {
    const treasury = getTrenchFeeRecipient(request);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(state.user, getAssociatedTokenAddress(NATIVE_MINT, state.user, TOKEN_PROGRAM_ID), state.user, NATIVE_MINT, TOKEN_PROGRAM_ID));
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(state.user, getAssociatedTokenAddress(NATIVE_MINT, treasury, TOKEN_PROGRAM_ID), treasury, NATIVE_MINT, TOKEN_PROGRAM_ID));
  }
  instructions.push(createSellV2Instruction(state, amount, minSolOutput));
  if (feeLamports > 0n) instructions.push(createTokenTransferInstruction(getAssociatedTokenAddress(NATIVE_MINT, state.user, TOKEN_PROGRAM_ID), getAssociatedTokenAddress(NATIVE_MINT, getTrenchFeeRecipient(request), TOKEN_PROGRAM_ID), state.user, feeLamports));

  return buildUnsignedTransaction(state.connection, state.user, instructions, feeLamports > 0n ? `Pump sell ${request.amount}% incl. 0.1% Trench fee` : `Pump sell ${request.amount}%`);
}

async function resolvePumpState(request: TradeRequest): Promise<PumpState> {
  if (!request.mint) throw new Error('Token mint not found');
  if (!request.wallet) throw new Error('Wallet not connected');

  const connection = new Connection(getActiveRpcUrl(request.settings), 'confirmed');
  const mint = new PublicKey(request.mint);
  const user = new PublicKey(request.wallet);
  const tokenProgram = await resolveTokenProgram(connection, mint);
  const bondingCurveAddress = bondingCurvePda(mint);

  const [globalAccount, bondingCurveAccount, feeConfigAccount, mintSupply] = await Promise.all([
    connection.getAccountInfo(globalPda()),
    connection.getAccountInfo(bondingCurveAddress),
    connection.getAccountInfo(pumpFeeConfigPda()).catch(() => null),
    fetchMintSupply(connection, mint)
  ]);

  if (!globalAccount) throw new Error('Pump global account not found');
  if (!bondingCurveAccount) throw new Error('Bonding curve account not found');

  return {
    connection,
    global: decodeGlobal(globalAccount.data),
    feeConfig: feeConfigAccount ? decodeFeeConfig(feeConfigAccount.data) : null,
    mint,
    user,
    tokenProgram,
    mintSupply,
    bondingCurve: decodeBondingCurve(bondingCurveAccount.data)
  };
}

function createBuyExactQuoteInV2Instruction(state: PumpState, spendableQuoteIn: bigint, minTokensOut: bigint, associatedUser: PublicKey) {
  const accounts = pumpTradeAccounts(state, associatedUser);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: accounts,
    data: Buffer.from(encodeInstruction(BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR, [spendableQuoteIn, minTokensOut]))
  });
}

function createSellV2Instruction(state: PumpState, amount: bigint, minSolOutput: bigint) {
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: pumpTradeAccounts(state, getAssociatedTokenAddress(state.mint, state.user, state.tokenProgram)),
    data: Buffer.from(encodeInstruction(SELL_V2_DISCRIMINATOR, [amount, minSolOutput]))
  });
}

function pumpTradeAccounts(state: PumpState, associatedBaseUser: PublicKey) {
  const quoteMint = normalizeQuoteMint(state.bondingCurve.quoteMint);
  const quoteTokenProgram = TOKEN_PROGRAM_ID;
  const bondingCurve = bondingCurvePda(state.mint);
  const feeRecipient = getFeeRecipient(state.global, state.bondingCurve.isMayhemMode);
  const buybackFeeRecipient = getStaticBuybackFeeRecipient();
  const creatorVault = creatorVaultPda(state.bondingCurve.creator);
  const userVolumeAccumulator = userVolumeAccumulatorPda(state.user);

  return [
    accountMeta(globalPda()),
    accountMeta(state.mint),
    accountMeta(quoteMint),
    accountMeta(state.tokenProgram),
    accountMeta(quoteTokenProgram),
    accountMeta(ASSOCIATED_TOKEN_PROGRAM_ID),
    accountMeta(feeRecipient, true),
    accountMeta(getAssociatedTokenAddress(quoteMint, feeRecipient, quoteTokenProgram), true),
    accountMeta(buybackFeeRecipient, true),
    accountMeta(getAssociatedTokenAddress(quoteMint, buybackFeeRecipient, quoteTokenProgram), true),
    accountMeta(bondingCurve, true),
    accountMeta(getAssociatedTokenAddress(state.mint, bondingCurve, state.tokenProgram), true),
    accountMeta(getAssociatedTokenAddress(quoteMint, bondingCurve, quoteTokenProgram), true),
    accountMeta(state.user, true, true),
    accountMeta(associatedBaseUser, true),
    accountMeta(getAssociatedTokenAddress(quoteMint, state.user, quoteTokenProgram), true),
    accountMeta(creatorVault, true),
    accountMeta(getAssociatedTokenAddress(quoteMint, creatorVault, quoteTokenProgram), true),
    accountMeta(feeSharingConfigPda(state.mint)),
    accountMeta(globalVolumeAccumulatorPda()),
    accountMeta(userVolumeAccumulator, true),
    accountMeta(getAssociatedTokenAddress(quoteMint, userVolumeAccumulator, quoteTokenProgram), true),
    accountMeta(pumpFeeConfigPda()),
    accountMeta(PUMP_FEE_PROGRAM_ID),
    accountMeta(SystemProgram.programId),
    accountMeta(eventAuthorityPda()),
    accountMeta(PUMP_PROGRAM_ID)
  ];
}

function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      accountMeta(payer, true, true),
      accountMeta(ata, true),
      accountMeta(owner),
      accountMeta(mint),
      accountMeta(SystemProgram.programId),
      accountMeta(tokenProgram)
    ],
    data: Buffer.from(Uint8Array.of(CREATE_ATA_IDEMPOTENT_DISCRIMINATOR))
  });
}

function createTokenTransferInstruction(source: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [accountMeta(source, true), accountMeta(destination, true), accountMeta(owner, false, true)],
    data: Buffer.from(encodeInstruction([SPL_TOKEN_TRANSFER_INSTRUCTION], [amount]))
  });
}

function decodeGlobal(data: Uint8Array): PumpGlobal {
  const reader = new AccountReader(data, GLOBAL_DISCRIMINATOR);
  reader.bool();
  reader.publicKey();
  const feeRecipient = reader.publicKey();
  reader.u64();
  reader.u64();
  reader.u64();
  reader.u64();
  const feeBasisPoints = reader.u64();
  reader.publicKey();
  reader.bool();
  reader.u64();
  const creatorFeeBasisPoints = reader.u64();
  const feeRecipients = reader.publicKeys(7);
  reader.publicKey();
  reader.publicKey();
  reader.bool();
  reader.publicKey();
  const reservedFeeRecipient = reader.publicKey();
  reader.bool();
  const reservedFeeRecipients = reader.publicKeys(7);

  return { feeRecipient, feeBasisPoints, creatorFeeBasisPoints, feeRecipients, reservedFeeRecipient, reservedFeeRecipients };
}

function decodeBondingCurve(data: Uint8Array): BondingCurve {
  const reader = new AccountReader(data, BONDING_CURVE_DISCRIMINATOR);
  const virtualTokenReserves = reader.u64();
  const virtualQuoteReserves = reader.u64();
  const realTokenReserves = reader.u64();
  reader.u64();
  reader.u64();
  const complete = reader.bool();
  const creator = reader.publicKey();
  const isMayhemMode = reader.bool();
  reader.bool();
  const quoteMint = reader.publicKey();

  return { virtualTokenReserves, virtualQuoteReserves, realTokenReserves, complete, creator, isMayhemMode, quoteMint };
}

function decodeFeeConfig(data: Uint8Array): FeeConfig {
  const reader = new AccountReader(data, FEE_CONFIG_DISCRIMINATOR);
  reader.u8();
  reader.publicKey();
  reader.fees();
  const feeTiers = reader.vec(() => {
    const marketCapLamportsThreshold = reader.u128();
    const { protocolFeeBps, creatorFeeBps } = reader.fees();
    return { marketCapLamportsThreshold, protocolFeeBps, creatorFeeBps };
  });

  return { feeTiers };
}

function getBuyTokenAmountFromQuoteAmount(state: PumpState, spendableQuoteIn: bigint) {
  const { bondingCurve } = state;
  if (spendableQuoteIn <= 0n || bondingCurve.virtualTokenReserves === 0n) return 0n;

  const totalFeeBps = getBuyFeeBps(state);
  let netQuote = (spendableQuoteIn * BASIS_POINTS) / (BASIS_POINTS + totalFeeBps);
  const fees = ceilDiv(netQuote * totalFeeBps, BASIS_POINTS);
  if (netQuote + fees > spendableQuoteIn) netQuote -= netQuote + fees - spendableQuoteIn;
  if (netQuote <= 1n) return 0n;

  const quoted = ((netQuote - 1n) * bondingCurve.virtualTokenReserves) / (bondingCurve.virtualQuoteReserves + netQuote - 1n);
  return minBigInt(quoted, bondingCurve.realTokenReserves);
}

function getSellQuoteAmountFromTokenAmount(state: PumpState, amount: bigint) {
  const { bondingCurve } = state;
  if (amount <= 0n || bondingCurve.virtualTokenReserves === 0n) return 0n;
  const quoteOut = (amount * bondingCurve.virtualQuoteReserves) / (bondingCurve.virtualTokenReserves + amount);
  return quoteOut - ceilDiv(quoteOut * getSellFeeBps(state), BASIS_POINTS);
}

function getBuyFeeBps(state: PumpState) {
  const fees = computeFeesBps(state, state.mintSupply);
  return fees.protocolFeeBps + getApplicableCreatorFeeBps(fees, state.bondingCurve);
}

function getSellFeeBps(state: PumpState) {
  const mintSupply = state.bondingCurve.isMayhemMode ? state.mintSupply : ONE_BILLION_SUPPLY;
  const fees = computeFeesBps(state, mintSupply);
  return fees.protocolFeeBps + getApplicableCreatorFeeBps(fees, state.bondingCurve);
}

function computeFeesBps(state: PumpState, mintSupply: bigint): FeeBps {
  if (state.feeConfig?.feeTiers.length) {
    return calculateFeeTier(state.feeConfig.feeTiers, bondingCurveMarketCap(state.bondingCurve, mintSupply));
  }

  return {
    protocolFeeBps: state.global.feeBasisPoints,
    creatorFeeBps: state.global.creatorFeeBasisPoints
  };
}

function calculateFeeTier(feeTiers: FeeTier[], marketCap: bigint): FeeBps {
  const firstTier = feeTiers[0];
  if (marketCap < firstTier.marketCapLamportsThreshold) return firstTier;

  for (let index = feeTiers.length - 1; index >= 0; index -= 1) {
    const tier = feeTiers[index];
    if (marketCap >= tier.marketCapLamportsThreshold) return tier;
  }

  return firstTier;
}

function bondingCurveMarketCap(bondingCurve: BondingCurve, mintSupply: bigint) {
  if (bondingCurve.virtualTokenReserves === 0n) return 0n;
  return (mintSupply * bondingCurve.virtualQuoteReserves) / bondingCurve.virtualTokenReserves;
}

function getApplicableCreatorFeeBps(fees: FeeBps, bondingCurve: BondingCurve) {
  return bondingCurve.creator.equals(PublicKey.default) ? 0n : fees.creatorFeeBps;
}

async function resolveTokenProgram(connection: Connection, mint: PublicKey) {
  const account = await connection.getAccountInfo(mint);
  if (!account) throw new Error('Mint account not found');
  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (account.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`Unsupported mint owner ${account.owner.toBase58()}`);
}

async function fetchMintSupply(connection: Connection, mint: PublicKey) {
  const supply = await connection.getTokenSupply(mint);
  return BigInt(supply.value.amount);
}

async function getUserTokenBalance(connection: Connection, mint: PublicKey, user: PublicKey, tokenProgram: PublicKey) {
  const ata = getAssociatedTokenAddress(mint, user, tokenProgram);
  const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
  return BigInt(balance?.value.amount ?? '0');
}

async function buildUnsignedTransaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  quoteSummary: string
): Promise<TradeResponse> {
  const blockhash = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash.blockhash,
    instructions
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);

  return {
    ok: true,
    route: 'pump',
    swapTransaction: bytesToBase64(transaction.serialize()),
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
    quoteSummary
  };
}

function globalPda() {
  return findPumpPda('global');
}

function bondingCurvePda(mint: PublicKey) {
  return findPumpPda('bonding-curve', mint);
}

function creatorVaultPda(creator: PublicKey) {
  return findPumpPda('creator-vault', creator);
}

function globalVolumeAccumulatorPda() {
  return findPumpPda('global_volume_accumulator');
}

function userVolumeAccumulatorPda(user: PublicKey) {
  return findPumpPda('user_volume_accumulator', user);
}

function eventAuthorityPda() {
  return findPumpPda('__event_authority');
}

function feeSharingConfigPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync([bytes('sharing-config'), mint.toBuffer()], PUMP_FEE_PROGRAM_ID)[0];
}

function pumpFeeConfigPda() {
  return PublicKey.findProgramAddressSync([bytes('fee_config'), PUMP_PROGRAM_ID.toBuffer()], PUMP_FEE_PROGRAM_ID)[0];
}

function findPumpPda(seed: string, key?: PublicKey) {
  const seeds = key ? [bytes(seed), key.toBuffer()] : [bytes(seed)];
  return PublicKey.findProgramAddressSync(seeds, PUMP_PROGRAM_ID)[0];
}

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function normalizeQuoteMint(quoteMint: PublicKey) {
  return quoteMint.equals(PublicKey.default) ? NATIVE_MINT : quoteMint;
}

function getFeeRecipient(global: PumpGlobal, mayhemMode: boolean) {
  const recipients = mayhemMode ? [global.reservedFeeRecipient, ...global.reservedFeeRecipients] : [global.feeRecipient, ...global.feeRecipients];
  return recipients[Math.floor(Math.random() * recipients.length)];
}

function getStaticBuybackFeeRecipient() {
  return STATIC_BUYBACK_FEE_RECIPIENTS[Math.floor(Math.random() * STATIC_BUYBACK_FEE_RECIPIENTS.length)];
}

function encodeInstruction(discriminator: number[], values: bigint[]) {
  const data = new Uint8Array(discriminator.length + values.length * 8);
  data.set(discriminator);
  values.forEach((value, index) => writeU64(data, discriminator.length + index * 8, value));
  return data;
}

function writeU64(data: Uint8Array, offset: number, value: bigint) {
  let current = value;
  for (let i = 0; i < 8; i += 1) {
    data[offset + i] = Number(current & 0xffn);
    current >>= 8n;
  }
}

function accountMeta(pubkey: PublicKey, isWritable = false, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}

function solToLamports(amount: number) {
  return BigInt(Math.round(amount * LAMPORTS_PER_SOL));
}

function applySlippageFloor(amount: bigint, slippagePercent: number) {
  const slippageTenths = BigInt(Math.max(0, Math.floor(slippagePercent * 10)));
  return amount - (amount * slippageTenths) / 1000n;
}

function ceilDiv(a: bigint, b: bigint) {
  return (a + b - 1n) / b;
}

function minBigInt(a: bigint, b: bigint) {
  return a < b ? a : b;
}

function priorityFeeToMicroLamports(priorityFeeSol: number) {
  if (!Number.isFinite(priorityFeeSol) || priorityFeeSol <= 0) return 1;
  return Math.max(1, Math.round((priorityFeeSol * LAMPORTS_PER_SOL * 1_000_000) / 400_000));
}

function calculateTrenchFee(amountLamports: bigint, request: TradeRequest) {
  return usesTrenchRouting(request.settings) ? (amountLamports * TRENCH_FEE_BPS) / BASIS_POINTS : 0n;
}

function getTrenchFeeRecipient(request: TradeRequest) {
  if (!request.settings.trenchFeeRecipient) throw new Error('Trench RPC mode requires a fee recipient public key');
  return new PublicKey(request.settings.trenchFeeRecipient);
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

class AccountReader {
  private offset = 8;

  constructor(private readonly data: Uint8Array, discriminator: number[]) {
    for (let i = 0; i < discriminator.length; i += 1) {
      if (data[i] !== discriminator[i]) throw new Error('Unexpected Pump account layout');
    }
  }

  bool() {
    return this.data[this.offset++] !== 0;
  }

  u8() {
    return this.data[this.offset++];
  }

  u64() {
    let value = 0n;
    for (let i = 0; i < 8; i += 1) value |= BigInt(this.data[this.offset + i]) << (BigInt(i) * 8n);
    this.offset += 8;
    return value;
  }

  u128() {
    let value = 0n;
    for (let i = 0; i < 16; i += 1) value |= BigInt(this.data[this.offset + i]) << (BigInt(i) * 8n);
    this.offset += 16;
    return value;
  }

  fees(): FeeBps {
    this.u64();
    const protocolFeeBps = this.u64();
    const creatorFeeBps = this.u64();
    return { protocolFeeBps, creatorFeeBps };
  }

  vec<T>(readItem: () => T) {
    const length = this.u32();
    return Array.from({ length }, readItem);
  }

  private u32() {
    let value = 0;
    for (let i = 0; i < 4; i += 1) value |= this.data[this.offset + i] << (i * 8);
    this.offset += 4;
    return value;
  }

  publicKey() {
    const key = new PublicKey(this.data.slice(this.offset, this.offset + 32));
    this.offset += 32;
    return key;
  }

  publicKeys(count: number) {
    return Array.from({ length: count }, () => this.publicKey());
  }
}
