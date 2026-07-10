import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addVaultAccount,
  createEmptyVault,
  removeVaultAccount,
  runBatchSequentially,
  setActiveVaultAccount,
  setSelectedVaultAccounts,
  normalizeVault,
  mergeLegacyVaultAccount,
  legacyAddressMatches,
  preparePasswordVaultMigration,
  createSerialQueue,
} from '../src/evmAccounts.ts';

function account(index) {
  return {
    id: `account-${index}`,
    name: `Wallet ${index}`,
    address: `0x${index.toString(16).padStart(40, '0')}`,
    encryptedPrivateKey: `secret-${index}`,
    createdAt: index,
  };
}

test('adds accounts and makes the first account active and selected', () => {
  const vault = addVaultAccount(createEmptyVault(), account(1));

  assert.equal(vault.activeAccountId, 'account-1');
  assert.deepEqual(vault.selectedAccountIds, ['account-1']);
});

test('rejects duplicate addresses and more than ten accounts', () => {
  let vault = createEmptyVault();
  for (let index = 1; index <= 10; index += 1) vault = addVaultAccount(vault, account(index));

  assert.throws(() => addVaultAccount(vault, account(11)), /10 accounts/);
  assert.throws(() => addVaultAccount(vault, { ...account(11), address: account(1).address.toUpperCase() }), /already exists/);
});

test('normalizes active and selected accounts after changes', () => {
  let vault = createEmptyVault();
  vault = addVaultAccount(vault, account(1));
  vault = addVaultAccount(vault, account(2));
  vault = setActiveVaultAccount(vault, 'account-2');
  vault = setSelectedVaultAccounts(vault, ['account-2', 'missing', 'account-2']);
  vault = removeVaultAccount(vault, 'account-2');

  assert.equal(vault.activeAccountId, 'account-1');
  assert.deepEqual(vault.selectedAccountIds, ['account-1']);
});

test('runs a batch sequentially and preserves partial failures', async () => {
  const started = [];
  let running = 0;
  let maxRunning = 0;
  const results = await runBatchSequentially(['a', 'b', 'c'], async (id) => {
    started.push(id);
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    if (id === 'b') throw new Error('insufficient balance');
    return { hash: `0x${id}` };
  });

  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.equal(maxRunning, 1);
  assert.deepEqual(results, [
    { accountId: 'a', ok: true, hash: '0xa' },
    { accountId: 'b', ok: false, error: 'insufficient balance' },
    { accountId: 'c', ok: true, hash: '0xc' },
  ]);
});

test('repairs malformed persisted selection without inventing accounts', () => {
  const normalized = normalizeVault({
    version: 2,
    activeAccountId: 'missing',
    selectedAccountIds: ['missing', 'account-2', 'account-2'],
    accounts: [account(1), account(2)],
  });

  assert.equal(normalized.activeAccountId, 'account-1');
  assert.deepEqual(normalized.selectedAccountIds, ['account-2']);
});

test('merges a legacy wallet into an already-created empty v2 vault', () => {
  const legacy = account(1);
  const merged = mergeLegacyVaultAccount(createEmptyVault(), legacy);

  assert.equal(merged.accounts.length, 1);
  assert.equal(merged.accounts[0].address, legacy.address);
  assert.equal(merged.activeAccountId, legacy.id);
  assert.deepEqual(merged.selectedAccountIds, [legacy.id]);
});

test('does not duplicate a legacy wallet already present in v2', () => {
  const legacy = account(1);
  const vault = addVaultAccount(createEmptyVault(), legacy);
  const merged = mergeLegacyVaultAccount(vault, { ...legacy, id: 'legacy-copy' });

  assert.equal(merged.accounts.length, 1);
  assert.equal(merged.accounts[0].id, legacy.id);
});

test('ignores the legacy pending address sentinel during recovery', () => {
  const recovered = account(1).address;
  assert.equal(legacyAddressMatches('pending', recovered), true);
  assert.equal(legacyAddressMatches(account(2).address, recovered), false);
});

test('migrates every password-vault record when the legacy session is available', async () => {
  const source = addVaultAccount(addVaultAccount(createEmptyVault(), account(1)), account(2));
  const originalCiphertexts = source.accounts.map((item) => item.encryptedPrivateKey);
  const migrated = await preparePasswordVaultMigration(source, async (item) => `device:${item.encryptedPrivateKey}`);

  assert.equal(migrated.disposition, 'migrated');
  assert.deepEqual(migrated.activeVault.accounts.map((item) => item.encryptedPrivateKey), originalCiphertexts.map((value) => `device:${value}`));
  assert.deepEqual(source.accounts.map((item) => item.encryptedPrivateKey), originalCiphertexts);
});

test('keeps an unavailable password vault out of the active device vault', async () => {
  const source = addVaultAccount(createEmptyVault(), account(1));
  const migrated = await preparePasswordVaultMigration(source);

  assert.equal(migrated.disposition, 'session-unavailable');
  assert.deepEqual(migrated.activeVault, createEmptyVault());
  assert.equal(source.accounts.length, 1);
});

test('keeps healthy accounts active when one archived record cannot migrate', async () => {
  const source = addVaultAccount(addVaultAccount(createEmptyVault(), account(1)), account(2));
  const migrated = await preparePasswordVaultMigration(source, async (item) => {
    if (item.id === 'account-1') throw new Error('corrupt record');
    return `device:${item.encryptedPrivateKey}`;
  });

  assert.equal(migrated.disposition, 'migrated');
  assert.deepEqual(migrated.activeVault.accounts.map((item) => item.id), ['account-2']);
  assert.equal(source.accounts.length, 2);
});

test('serial queue preserves order and continues after a rejected task', async () => {
  const enqueue = createSerialQueue();
  const events = [];
  const first = enqueue(async () => {
    events.push('first:start');
    await new Promise((resolve) => setTimeout(resolve, 2));
    events.push('first:end');
    return 'first';
  });
  const second = enqueue(async () => {
    events.push('second');
    throw new Error('expected failure');
  });
  const third = enqueue(async () => {
    events.push('third');
    return 'third';
  });

  assert.equal(await first, 'first');
  await assert.rejects(second, /expected failure/);
  assert.equal(await third, 'third');
  assert.deepEqual(events, ['first:start', 'first:end', 'second', 'third']);
});
