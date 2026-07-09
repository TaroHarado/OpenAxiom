document.getElementById('trenches')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('trenches.html') });
});

document.getElementById('options')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('manage')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refreshHotWalletStatus();
refreshEvmWalletStatus();

document.getElementById('import')?.addEventListener('click', () => {
  const result = document.getElementById('result');
  const secret = document.getElementById('secret');

  const keyValue = secret?.value ?? '';
  if (secret) secret.value = '';

  chrome.runtime.sendMessage({ type: 'TRENCH_HOT_WALLET_IMPORT', secretKey: keyValue }, (response) => {
    void chrome.runtime.lastError;
    if (response?.ok) {
      if (result) result.textContent = `Hot wallet imported: ${shortKey(response.publicKey)}`;
      renderHotWalletStatus(response);
      return;
    }
    if (result) result.textContent = response?.error ?? 'Hot wallet import failed.';
  });
});

document.getElementById('rh-import')?.addEventListener('click', () => {
  const result = document.getElementById('result');
  const secret = document.getElementById('rh-secret');

  let keyValue = (secret?.value ?? '').trim();
  if (secret) secret.value = '';
  if (keyValue && !keyValue.startsWith('0x')) keyValue = '0x' + keyValue;

  if (!/^0x[0-9a-fA-F]{64}$/.test(keyValue)) {
    if (result) result.textContent = 'Robinhood key must be 0x + 64 hex chars.';
    return;
  }

  chrome.runtime.sendMessage({ type: 'TRENCH_EVM_WALLET_IMPORT', privateKey: keyValue }, (response) => {
    void chrome.runtime.lastError;
    if (response?.ok) {
      if (result) result.textContent = `Robinhood wallet imported: ${shortKey(response.address)}`;
      renderEvmWalletStatus(response);
      return;
    }
    if (result) result.textContent = response?.error ?? 'Robinhood wallet import failed.';
  });
});

document.getElementById('force')?.addEventListener('click', async () => {
  const result = document.getElementById('result');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      if (result) result.textContent = 'No active tab found.';
      return;
    }

    const url = new URL(tab.url);
    const isSupportedHost = url.hostname.endsWith('axiom.trade') || url.hostname === 'gmgn.ai';
    if (url.protocol !== 'https:' || !isSupportedHost) {
      if (result) result.textContent = 'Open an axiom.trade or gmgn.ai tab first.';
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.getElementById('trench-injection-probe')?.remove();
        const root = document.getElementById('trench-shadow-root');
        const hasPanel = Boolean(root?.shadowRoot?.querySelector('.tw-widget, .tw-compact'));
        if (root && !hasPanel) root.remove();
        localStorage.removeItem('trench.collapsed.v1');
        localStorage.setItem('trench.position.v1', JSON.stringify({ x: 24, y: 72 }));
      }
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const [{ result: mounted }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.dispatchEvent(new CustomEvent('trench:force-open'));
        return Boolean(document.getElementById('trench-shadow-root'));
      }
    });

    if (result) result.textContent = mounted ? 'Trench panel opened on this tab.' : 'Injection ran, but the panel could not mount here.';
  } catch (error) {
    if (result) result.textContent = error instanceof Error ? error.message : 'Injection failed.';
  }
});

function shortKey(value) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
}

function refreshHotWalletStatus() {
  chrome.runtime.sendMessage({ type: 'TRENCH_HOT_WALLET_STATUS' }, (response) => {
    void chrome.runtime.lastError;
    renderHotWalletStatus(response);
  });
}

function renderHotWalletStatus(response) {
  const status = document.getElementById('wallet-status');
  const walletBox = document.getElementById('wallet-box');
  if (!status || !walletBox) return;

  if (!response?.hasWallet) {
    status.textContent = '';
    walletBox.classList.remove('hidden');
    return;
  }

  const state = response.unlocked ? 'Solana wallet active' : 'Solana wallet imported, locked';
  const balance = typeof response.walletSol === 'number' ? `SOL: ${response.walletSol.toFixed(6)}` : (response.balanceError ? `SOL: balance RPC error (${response.balanceError})` : 'SOL: unknown');
  status.textContent = `${state}: ${shortKey(response.publicKey)} · ${balance}`;
  walletBox.classList.add('hidden');
}

function refreshEvmWalletStatus() {
  chrome.runtime.sendMessage({ type: 'TRENCH_EVM_WALLET_STATUS' }, (response) => {
    void chrome.runtime.lastError;
    renderEvmWalletStatus(response);
  });
}

function renderEvmWalletStatus(response) {
  const status = document.getElementById('rh-status');
  const box = document.getElementById('rh-box');
  if (!status || !box) return;

  if (!response?.hasWallet) {
    status.textContent = '';
    box.classList.remove('hidden');
    return;
  }

  const state = response.unlocked ? 'Robinhood wallet active' : 'Robinhood wallet imported, locked';
  status.textContent = `${state}: ${shortKey(response.address)}`;
  box.classList.add('hidden');
}
