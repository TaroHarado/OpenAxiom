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
  hotkeys: boolean;
  showOnGmgn: boolean;
};

export type TokenContext = {
  mint: string | null;
  symbol: string;
  source: 'url' | 'dom' | 'unknown';
};

export type EvmTradeRequest = {
  type: 'TRENCH_EVM_TRADE';
  accountId?: string;
  side: TradeSide;
  tokenAddress: string;
  pairAddress?: string;
  poolFee?: number;
  amountUsdg: number;
  slippageBps: number;
};

export type EvmAccount = {
  id: string;
  name: string;
  address: string;
  active: boolean;
  selected: boolean;
  createdAt: number;
};

export type EvmAccountsResponse = {
  ok: boolean;
  accounts: EvmAccount[];
  activeAccountId: string | null;
  selectedAccountIds: string[];
  error?: string;
  privateKey?: string;
  createdAccountId?: string;
  legacyRecoveryRequired?: boolean;
  passwordVaultArchived?: boolean;
};

export type EvmAccountsRequest =
  | { type: 'TRENCH_EVM_ACCOUNTS_LIST' }
  | { type: 'TRENCH_EVM_ACCOUNT_CREATE'; name: string }
  | { type: 'TRENCH_EVM_ACCOUNT_IMPORT'; name: string; privateKey: string }
  | { type: 'TRENCH_EVM_ACCOUNT_EXPORT'; accountId: string }
  | { type: 'TRENCH_EVM_ACCOUNT_RENAME'; accountId: string; name: string }
  | { type: 'TRENCH_EVM_ACCOUNT_REMOVE'; accountId: string }
  | { type: 'TRENCH_EVM_ACCOUNT_SET_ACTIVE'; accountId: string }
  | { type: 'TRENCH_EVM_ACCOUNTS_SET_SELECTED'; accountIds: string[] };

export type EvmBatchTradeRequest = Omit<EvmTradeRequest, 'type' | 'accountId'> & {
  type: 'TRENCH_EVM_BATCH_TRADE';
  accountIds: string[];
};

export type EvmPrewarmRouteRequest = {
  type: 'TRENCH_EVM_PREWARM_ROUTE';
  tokenAddress: string;
  side?: TradeSide;
};

export type EvmBatchTradeItem = EvmTradeResponse & {
  accountId: string;
  name: string;
  address: string;
};

export type EvmBatchTradeResponse = {
  ok: boolean;
  results: EvmBatchTradeItem[];
  error?: string;
};

export type EvmTradeResponse = {
  ok: boolean;
  hash?: string;
  status?: 'pending' | 'confirmed' | 'failed';
  error?: string;
};

export type OrderStatus = 'Sent' | 'Failed';

export type TradeOrder = {
  id: string;
  side: TradeSide;
  mint: string | null;
  wallet: string;
  signature?: string;
  summary?: string;
  error?: string;
  size: string;
  status: OrderStatus;
  createdAt: number;
};
