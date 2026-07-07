export type TradeSide = 'buy' | 'sell';

export type ToastKind = 'success' | 'error' | 'info';

export type WidgetPosition = {
  x: number;
  y: number;
};

export type TradeSettings = {
  buyAmounts: number[];
  sellPercents: number[];
  selectedBuyAmount: number;
  selectedSellPercent: number;
  slippage: number;
  priorityFee: number;
  jitoTip: number;
  protection: boolean;
  confirmation: boolean;
  hotkeys: boolean;
  rpcMode: 'custom' | 'trench';
  rpcUrl: string;
  trenchRpcUrl: string;
  trenchFeeRecipient: string;
  signerMode: 'wallet' | 'local';
  localWalletPublicKey: string;
  sendMode: 'rpc' | 'jito';
  jitoEndpoint: string;
  jitoBundleOnly: boolean;
  executionMode: 'jupiter' | 'pump' | 'auto';
};

export type TokenContext = {
  mint: string | null;
  symbol: string;
  source: 'axiom-url' | 'dom' | 'unknown';
};

export type PositionState = {
  walletSol: number;
  walletWsol: number;
  tokenAmount: number;
  tokenRawAmount: string;
  tokenSymbol: string;
  costBasisSol: number;
  realizedPnlSol: number;
  pnlUsd: number;
  pnlSol: number;
};

export type OrderStatus = 'Active' | 'Failed' | 'Canceled';

export type TradeOrder = {
  id: string;
  side: TradeSide;
  condition: string;
  size: string;
  status: OrderStatus;
};

export type TradeRequest = {
  type: 'TRENCH_PREPARE_TRADE';
  side: TradeSide;
  amount: number;
  mint: string | null;
  wallet: string;
  settings: TradeSettings;
};

export type TradeResponse = {
  ok: boolean;
  swapTransaction?: string;
  lastValidBlockHeight?: number;
  quoteSummary?: string;
  route?: 'pump' | 'jupiter';
  signature?: string;
  error?: string;
};

export type SendSignedTransactionRequest = {
  type: 'TRENCH_SEND_SIGNED_TRANSACTION';
  signedTransaction: string;
  settings: TradeSettings;
};

export type SignAndSendLocalRequest = {
  type: 'TRENCH_SIGN_AND_SEND_LOCAL';
  transaction: string;
  settings: TradeSettings;
};

export type PositionRequest = {
  type: 'TRENCH_GET_POSITION';
  wallet: string;
  mint: string | null;
  settings: TradeSettings;
};

export type PositionResponse = {
  ok: boolean;
  walletSol?: number;
  walletWsol?: number;
  tokenAmount?: number;
  tokenRawAmount?: string;
  tokenDecimals?: number;
  error?: string;
};

export type HotWalletRequest =
  | { type: 'TRENCH_HOT_WALLET_STATUS' }
  | { type: 'TRENCH_HOT_WALLET_IMPORT'; secretKey: string; password: string }
  | { type: 'TRENCH_HOT_WALLET_UNLOCK'; password: string }
  | { type: 'TRENCH_HOT_WALLET_LOCK' }
  | { type: 'TRENCH_HOT_WALLET_FORGET' };

export type HotWalletResponse = {
  ok: boolean;
  hasWallet?: boolean;
  unlocked?: boolean;
  publicKey?: string;
  error?: string;
};

export type WalletBridgeRequest = {
  id: string;
  type: 'TRENCH_WALLET_CONNECT' | 'TRENCH_WALLET_SIGN_TRANSACTION';
  transaction?: string;
};

export type WalletBridgeResponse = {
  id: string;
  type: 'TRENCH_WALLET_RESPONSE';
  ok: boolean;
  publicKey?: string;
  signedTransaction?: string;
  error?: string;
};
