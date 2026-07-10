document.getElementById('options')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

const importPanel = document.getElementById('wallet-import');
const importToggle = document.getElementById('toggle-import');
const importButton = document.getElementById('import-wallet');
const privateKeyInput = document.getElementById('wallet-private-key');
const nameInput = document.getElementById('wallet-name');
const result = document.getElementById('result');
let accountState = null;

importToggle?.addEventListener('click', () => {
  importPanel?.classList.toggle('hidden');
});

importButton?.addEventListener('click', () => void importMainWallet());

void refreshWallets();

async function refreshWallets() {
  let response;
  try {
    response = await sendMessage({ type: 'TRENCH_EVM_ACCOUNTS_LIST' });
  } catch (error) {
    renderUnavailable(error.message);
    return;
  }

  accountState = response;
  const state = document.getElementById('extension-state');
  const status = document.getElementById('wallet-status');
  if (!response?.ok && !response?.legacyRecoveryRequired) {
    renderUnavailable(response?.error ?? 'Open Options to recover wallet storage.');
    return;
  }

  if (response.legacyRecoveryRequired) {
    if (state) state.textContent = 'Recovery required';
    if (status) status.textContent = response.error ?? 'Open Options to recover the legacy wallet.';
    importPanel?.classList.add('hidden');
    if (importToggle) importToggle.disabled = true;
    return;
  }

  const active = response.accounts.find((account) => account.id === response.activeAccountId);
  if (state) state.textContent = 'Wallet storage ready';
  if (importToggle) importToggle.disabled = false;
  if (!status) return;
  if (!response.accounts.length) {
    status.textContent = 'No wallets configured. Import your main Robinhood wallet below.';
    importPanel?.classList.remove('hidden');
    return;
  }
  const activeLabel = active ? `${active.name}: ${shortAddress(active.address)}` : 'No active wallet';
  status.textContent = `${activeLabel} · ${response.selectedAccountIds.length}/${response.accounts.length} selected`;
}

async function importMainWallet() {
  const privateKey = normalizePrivateKey(privateKeyInput?.value ?? '');
  const name = nameInput?.value.trim() || 'Main wallet';
  setResult('');

  if (!privateKey) {
    setResult('Private key must contain 64 hexadecimal characters.', true);
    return;
  }
  if (accountState?.legacyRecoveryRequired) {
    setResult('Recover the legacy wallet in Options first.', true);
    return;
  }
  if (importButton) {
    importButton.disabled = true;
    importButton.textContent = 'Importing...';
  }

  try {
    const imported = await sendMessage({
      type: 'TRENCH_EVM_ACCOUNT_IMPORT',
      name,
      privateKey,
    });
    if (!imported?.ok) throw new Error(imported?.error ?? 'Wallet import failed');

    let finalState = imported;
    if (imported.createdAccountId) {
      const activated = await sendMessage({
        type: 'TRENCH_EVM_ACCOUNT_SET_ACTIVE',
        accountId: imported.createdAccountId,
      });
      if (!activated?.ok) throw new Error(activated?.error ?? 'Wallet imported but could not be activated');
      finalState = activated;
    }

    accountState = finalState;
    if (privateKeyInput) privateKeyInput.value = '';
    setResult('Main Robinhood wallet imported and activated.');
    await refreshWallets();
  } catch (error) {
    setResult(error instanceof Error ? error.message : 'Wallet import failed', true);
  } finally {
    if (importButton) {
      importButton.disabled = false;
      importButton.textContent = 'Import and make active';
    }
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizePrivateKey(value) {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? normalized : '';
}

function setResult(message, error = false) {
  if (!result) return;
  result.textContent = message;
  result.classList.toggle('error', error);
}

function renderUnavailable(message) {
  const state = document.getElementById('extension-state');
  const status = document.getElementById('wallet-status');
  if (state) state.textContent = 'Wallet unavailable';
  if (status) status.textContent = message;
}

function shortAddress(value) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
