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
  rpcUrl: string;
  executionMode: 'jupiter' | 'pump' | 'auto';
};

export type TokenContext = {
  mint: string | null;
  symbol: string;
};

export type PositionState = {
  walletSol: number;
  tokenAmount: number;
  tokenSymbol: string;
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
  type: 'TRADEWIZ_PREPARE_TRADE';
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
  type: 'TRADEWIZ_SEND_SIGNED_TRANSACTION';
  signedTransaction: string;
  rpcUrl: string;
};

export type WalletBridgeRequest = {
  id: string;
  type: 'TRADEWIZ_WALLET_CONNECT' | 'TRADEWIZ_WALLET_SIGN_TRANSACTION';
  transaction?: string;
};

export type WalletBridgeResponse = {
  id: string;
  type: 'TRADEWIZ_WALLET_RESPONSE';
  ok: boolean;
  publicKey?: string;
  signedTransaction?: string;
  error?: string;
};
