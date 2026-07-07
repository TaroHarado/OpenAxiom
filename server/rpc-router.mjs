import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const REQUEST_LIMIT_BYTES = 1024 * 1024;
const WINDOW_MS = Number(process.env.TRENCH_RATE_WINDOW_MS || 60_000);
const MAX_REQUESTS_PER_WINDOW = Number(process.env.TRENCH_RATE_LIMIT || 180);
const UPSTREAMS = parseUpstreams(process.env.TRENCH_RPC_UPSTREAMS || 'https://api.mainnet-beta.solana.com');

const clients = new Map();

if (!UPSTREAMS.length) {
  throw new Error('TRENCH_RPC_UPSTREAMS must contain at least one HTTPS Solana RPC URL');
}

const server = http.createServer(async (request, response) => {
  setCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      upstreams: UPSTREAMS.map(({ url, score, failures, lastMs }) => ({ url: redactUrl(url), score, failures, lastMs }))
    });
    return;
  }

  if (request.method !== 'POST' || !request.url?.startsWith('/rpc')) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const client = getClientIp(request);
  if (!takeRateLimit(client)) {
    sendJson(response, 429, { error: 'Rate limit exceeded' });
    return;
  }

  try {
    const body = await readBody(request);
    const payload = JSON.parse(body);
    if (!isJsonRpcPayload(payload)) {
      sendJson(response, 400, { error: 'Invalid JSON-RPC payload' });
      return;
    }

    const result = await forwardWithRetry(body);
    response.writeHead(result.status, { 'Content-Type': 'application/json' });
    response.end(result.body);
  } catch (error) {
    sendJson(response, 502, { error: error instanceof Error ? error.message : 'RPC router failed' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Trench RPC router listening on :${PORT} with ${UPSTREAMS.length} upstream(s)`);
});

function parseUpstreams(value) {
  return value
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error(`Upstream must use HTTPS: ${url}`);
      return { url, score: 0, failures: 0, lastMs: null };
    });
}

async function forwardWithRetry(body) {
  const ordered = [...UPSTREAMS].sort((a, b) => a.score - b.score);
  let lastError = null;

  for (const upstream of ordered) {
    const started = performance.now();
    try {
      const response = await fetch(upstream.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8_000)
      });
      const text = await response.text();
      const ms = Math.round(performance.now() - started);
      updateScore(upstream, response.ok, ms, response.status);

      if (response.ok) return { status: response.status, body: text };
      lastError = new Error(`Upstream ${redactUrl(upstream.url)} returned HTTP ${response.status}`);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      updateScore(upstream, false, Math.round(performance.now() - started), 599);
      lastError = error;
    }
  }

  throw lastError ?? new Error('All upstream RPCs failed');
}

function updateScore(upstream, ok, ms, status) {
  upstream.lastMs = ms;
  if (ok) {
    upstream.failures = 0;
    upstream.score = Math.max(0, Math.round(upstream.score * 0.6 + ms * 0.4));
    return;
  }

  upstream.failures += 1;
  upstream.score += status === 429 ? 5_000 : 2_000;
}

function isJsonRpcPayload(payload) {
  if (Array.isArray(payload)) return payload.every(isJsonRpcPayload);
  return payload && typeof payload === 'object' && payload.jsonrpc === '2.0' && typeof payload.method === 'string';
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > REQUEST_LIMIT_BYTES) {
        reject(new Error('Request too large'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function takeRateLimit(client) {
  const now = Date.now();
  const bucket = clients.get(client);
  if (!bucket || bucket.resetAt <= now) {
    clients.set(client, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MAX_REQUESTS_PER_WINDOW;
}

function getClientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function redactUrl(rawUrl) {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (/key|token|secret|auth/i.test(key)) url.searchParams.set(key, 'redacted');
  }
  return url.toString();
}
