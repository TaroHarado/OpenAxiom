document.getElementById('options')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('import')?.addEventListener('click', () => {
  const result = document.getElementById('result');
  const secret = document.getElementById('secret');

  const keyValue = secret?.value ?? '';
  if (secret) secret.value = '';

  chrome.runtime.sendMessage({ type: 'TRENCH_HOT_WALLET_IMPORT', secretKey: keyValue }, (response) => {
    void chrome.runtime.lastError;
    if (response?.ok) {
      if (result) result.textContent = `Hot wallet imported: ${shortKey(response.publicKey)}`;
      return;
    }
    if (result) result.textContent = response?.error ?? 'Hot wallet import failed.';
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
    if (url.protocol !== 'https:' || !url.hostname.endsWith('axiom.trade')) {
      if (result) result.textContent = 'Open an axiom.trade tab first.';
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const existing = document.getElementById('trench-injection-probe');
        if (existing) existing.remove();

        const badge = document.createElement('div');
        badge.id = 'trench-injection-probe';
        badge.textContent = 'Trench injector reached this page';
        Object.assign(badge.style, {
          position: 'fixed',
          top: '14px',
          right: '14px',
          zIndex: '2147483647',
          padding: '10px 12px',
          border: '1px solid rgba(20, 241, 149, 0.55)',
          borderRadius: '8px',
          background: '#07110d',
          color: '#9fffd8',
          font: '700 12px Inter, system-ui, sans-serif',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)'
        });
        document.documentElement.appendChild(badge);
      }
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    if (result) result.textContent = 'Probe badge injected. Panel injection requested.';
  } catch (error) {
    if (result) result.textContent = error instanceof Error ? error.message : 'Injection failed.';
  }
});

function shortKey(value) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
}
