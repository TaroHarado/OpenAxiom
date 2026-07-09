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
  autoFee: boolean;
  autoFeeLevel: 'normal' | 'fast' | 'turbo';
  autoFeeMax: number;
  protection: boolean;
  confirmation: boolean;
  hotkeys: boolean;
  rpcUrl: string;
  signerMode: 'wallet' | 'local';
  localWalletPublicKey: string;
  sendMode: 'rpc' | 'jito';
  jitoEndpoint: string;
  jitoBundleOnly: boolean;
  executionMode: 'jupiter' | 'pump' | 'auto';
};

export type TradePreset = {
  id: string;
  name: string;
  settings: TradeSettings;
  updatedAt: number;
};

export type TradePresetState = {
  activePresetId: string;
  presets: TradePreset[];
};

export type SupportedChain = 'solana' | 'robinhood';

export type TokenContext = {
  mint: string | null;
  symbol: string;
  source: 'axiom-url' | 'dom' | 'unknown';
  chain?: SupportedChain;
};

export type EvmInputCurrency = 'USDG' | 'ETH';

export type EvmTradeRequest = {
  type: 'TRENCH_EVM_TRADE';
  side: TradeSide;
  tokenAddress: string;
  amountUsdg: number;
  slippageBps: number;
  inputCurrency?: EvmInputCurrency;
};

export type EvmTradeResponse = {
  ok: boolean;
  hash?: string;
  error?: string;
};

export type EvmPositionRequest = {
  type: 'TRENCH_EVM_GET_POSITION';
  wallet: string;
  tokenAddress: string;
};

export type EvmPositionResponse = {
  ok: boolean;
  ethBalance?: string;
  tokenBalance?: string;
  error?: string;
};

export type EvmWalletRequest =
  | { type: 'TRENCH_EVM_WALLET_IMPORT'; privateKey: string }
  | { type: 'TRENCH_EVM_WALLET_STATUS' }
  | { type: 'TRENCH_EVM_WALLET_LOCK' }
  | { type: 'TRENCH_EVM_WALLET_FORGET' };

export type EvmWalletResponse = {
  ok: boolean;
  hasWallet?: boolean;
  unlocked?: boolean;
  address?: string;
  error?: string;
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

export type OrderStatus = 'Sent' | 'Failed';

export type TradeOrder = {
  id: string;
  side: TradeSide;
  mint: string | null;
  wallet: string;
  route?: 'pump' | 'jupiter';
  signature?: string;
  summary?: string;
  error?: string;
  size: string;
  status: OrderStatus;
  createdAt: number;
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
  | { type: 'TRENCH_HOT_WALLET_REFRESH' }
  | { type: 'TRENCH_HOT_WALLET_IMPORT'; secretKey: string }
  | { type: 'TRENCH_HOT_WALLET_UNLOCK' }
  | { type: 'TRENCH_HOT_WALLET_LOCK' }
  | { type: 'TRENCH_HOT_WALLET_FORGET' };

export type HotWalletResponse = {
  ok: boolean;
  hasWallet?: boolean;
  unlocked?: boolean;
  publicKey?: string;
  walletSol?: number;
  balanceError?: string;
  error?: string;
};

export type IndexHistoryRequest = {
  type: 'TRENCH_INDEX_HISTORY';
  wallet: string;
  mint: string;
  settings: TradeSettings;
};

export type IndexHistoryResponse = {
  ok: boolean;
  scanned: number;
  matched: number;
  costBasisSol: number;
  realizedPnlSol: number;
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
