export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  return exponential * (0.5 + Math.random() * 0.5);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const doFetch = opts.fetchImpl ?? fetch;

  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const headerDelay = lastResponse ? retryAfterMs(lastResponse) : null;
      if (lastResponse) {
        try { await lastResponse.body?.cancel(); } catch { /* ignore */ }
        lastResponse = null;
      }
      await sleep(headerDelay ?? backoffDelay(attempt - 1, baseDelayMs, maxDelayMs));
    }
    try {
      const response = await doFetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!RETRYABLE_STATUS.has(response.status)) return response;
      lastResponse = response;
      lastError = undefined;
    } catch (err) {
      lastError = err;
      lastResponse = null;
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError));
}
