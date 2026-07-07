import { VersionedTransaction } from '@solana/web3.js';
import type { WalletBridgeRequest, WalletBridgeResponse } from './types';

type SolanaProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString: () => string };
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
  }
}

window.addEventListener('message', async (event: MessageEvent<WalletBridgeRequest>) => {
  if (event.source !== window) return;
  const request = event.data;
  if (!request || !request.type?.startsWith('TRENCH_WALLET_')) return;

  try {
    if (request.type === 'TRENCH_WALLET_CONNECT') {
      const provider = getProvider();
      const response = await provider.connect();
      postResponse({ id: request.id, ok: true, publicKey: response.publicKey.toString() });
      return;
    }

    if (request.type === 'TRENCH_WALLET_SIGN_TRANSACTION') {
      if (!request.transaction) throw new Error('Missing transaction');
      const provider = getProvider();
      const transaction = VersionedTransaction.deserialize(base64ToBytes(request.transaction));
      const signed = await provider.signTransaction(transaction);
      const serialized = serializeTransaction(signed);
      postResponse({ id: request.id, ok: true, signedTransaction: bytesToBase64(serialized) });
    }
  } catch (error) {
    postResponse({ id: request.id, ok: false, error: error instanceof Error ? error.message : 'Wallet error' });
  }
});

function getProvider() {
  if (!window.solana) throw new Error('Wallet not found');
  return window.solana;
}

function serializeTransaction(transaction: VersionedTransaction): Uint8Array {
  return transaction.serialize();
}

function postResponse(response: Omit<WalletBridgeResponse, 'type'>) {
  window.postMessage({ ...response, type: 'TRENCH_WALLET_RESPONSE' }, window.location.origin);
}

function base64ToBytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}
