export const MAX_EVM_ACCOUNTS = 10;

export type EvmAccountRecord = {
  id: string;
  name: string;
  address: string;
  encryptedPrivateKey: string;
  createdAt: number;
};

export type EvmAccountVault = {
  version: 2;
  activeAccountId: string | null;
  selectedAccountIds: string[];
  accounts: EvmAccountRecord[];
};

export type BatchExecutionResult = {
  accountId: string;
  ok: boolean;
  hash?: string;
  error?: string;
};

export type PasswordVaultMigrationResult = {
  activeVault: EvmAccountVault;
  disposition: 'migrated' | 'session-unavailable';
};

export function createEmptyVault(): EvmAccountVault {
  return { version: 2, activeAccountId: null, selectedAccountIds: [], accounts: [] };
}

export function addVaultAccount(vault: EvmAccountVault, account: EvmAccountRecord): EvmAccountVault {
  if (vault.accounts.some((item) => item.address.toLowerCase() === account.address.toLowerCase())) {
    throw new Error('This wallet already exists');
  }
  if (vault.accounts.length >= MAX_EVM_ACCOUNTS) throw new Error('Maximum of 10 accounts reached');
  return normalizeVault({ ...vault, accounts: [...vault.accounts, account] });
}

export function mergeLegacyVaultAccount(vault: EvmAccountVault, account: EvmAccountRecord): EvmAccountVault {
  if (vault.accounts.some((item) => item.address.toLowerCase() === account.address.toLowerCase())) return normalizeVault(vault);
  return addVaultAccount(vault, account);
}

export function legacyAddressMatches(expectedAddress: string | undefined, recoveredAddress: string) {
  return !expectedAddress || !/^0x[0-9a-fA-F]{40}$/.test(expectedAddress) || expectedAddress.toLowerCase() === recoveredAddress.toLowerCase();
}

export function removeVaultAccount(vault: EvmAccountVault, accountId: string): EvmAccountVault {
  return normalizeVault({ ...vault, accounts: vault.accounts.filter((account) => account.id !== accountId) });
}

export function setActiveVaultAccount(vault: EvmAccountVault, accountId: string): EvmAccountVault {
  if (!vault.accounts.some((account) => account.id === accountId)) throw new Error('Wallet not found');
  return normalizeVault({ ...vault, activeAccountId: accountId });
}

export function setSelectedVaultAccounts(vault: EvmAccountVault, accountIds: string[]): EvmAccountVault {
  return normalizeVault({ ...vault, selectedAccountIds: accountIds });
}

export function normalizeVault(vault: EvmAccountVault): EvmAccountVault {
  const accounts = vault.accounts.slice(0, MAX_EVM_ACCOUNTS);
  const ids = new Set(accounts.map((account) => account.id));
  const activeAccountId = vault.activeAccountId && ids.has(vault.activeAccountId)
    ? vault.activeAccountId
    : accounts[0]?.id ?? null;
  const selectedAccountIds = [...new Set(vault.selectedAccountIds)].filter((id) => ids.has(id));
  if (!selectedAccountIds.length && activeAccountId) selectedAccountIds.push(activeAccountId);
  return { version: 2, activeAccountId, selectedAccountIds, accounts };
}

export async function preparePasswordVaultMigration(
  vault: EvmAccountVault,
  reencryptPrivateKey?: (account: EvmAccountRecord) => Promise<string>,
): Promise<PasswordVaultMigrationResult> {
  if (!reencryptPrivateKey) return { activeVault: createEmptyVault(), disposition: 'session-unavailable' };
  const accounts: EvmAccountRecord[] = [];
  for (const account of vault.accounts) {
    try {
      accounts.push({ ...account, encryptedPrivateKey: await reencryptPrivateKey(account) });
    } catch {
      // The untouched record remains in the password-vault archive for manual recovery.
    }
  }
  return {
    activeVault: normalizeVault({ ...vault, accounts }),
    disposition: 'migrated',
  };
}

export async function runBatchSequentially<T extends { hash?: string }>(
  accountIds: string[],
  execute: (accountId: string) => Promise<T>,
): Promise<BatchExecutionResult[]> {
  const results: BatchExecutionResult[] = [];
  for (const accountId of accountIds) {
    try {
      const result = await execute(accountId);
      results.push({ accountId, ok: true, hash: result.hash });
    } catch (error) {
      results.push({ accountId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const current = tail.then(task, task);
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
}
