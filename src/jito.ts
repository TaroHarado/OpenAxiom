import { PublicKey, SystemProgram } from '@solana/web3.js';
import type { TradeSettings } from './types';

const LAMPORTS_PER_SOL = 1_000_000_000;
const JITO_TIP_ACCOUNT = new PublicKey('96gYZGLn4jS6nmEbnvXvU1umCDyjmYVQMNxnk4x5uHDi');

export function createJitoTipInstruction(payer: PublicKey, settings: TradeSettings) {
  if (settings.sendMode !== 'jito' || !Number.isFinite(settings.jitoTip) || settings.jitoTip <= 0) return null;

  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: JITO_TIP_ACCOUNT,
    lamports: Math.round(settings.jitoTip * LAMPORTS_PER_SOL)
  });
}
