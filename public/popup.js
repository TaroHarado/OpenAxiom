document.getElementById('options')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
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
      files: ['content.js']
    });

    if (result) result.textContent = 'Panel injection requested. Check the page.';
  } catch (error) {
    if (result) result.textContent = error instanceof Error ? error.message : 'Injection failed.';
  }
});
