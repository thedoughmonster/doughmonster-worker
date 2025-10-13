export interface FetchWithBackoffOptions {
  retries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export async function fetchWithBackoff(
  input: RequestInfo | URL,
  init: (RequestInit & { timeoutMs?: number }) | undefined = {},
  options: FetchWithBackoffOptions = {}
): Promise<Response> {
  const { timeoutMs = 15_000, signal, ...restInit } = init ?? {};
  const { retries = 3, initialBackoffMs = 250, maxBackoffMs = 8_000 } = options;

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
      }

      const abortHandler = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abortHandler, { once: true });
      controller.signal.addEventListener(
        "abort",
        () => signal.removeEventListener("abort", abortHandler),
        { once: true }
      );
    }

    try {
      const response = await fetch(input, { ...restInit, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      const shouldRetry =
        response.status === 429 || (response.status >= 500 && response.status < 600);

      if (shouldRetry && attempt < retries) {
        const delay = computeDelay(response, attempt, initialBackoffMs, maxBackoffMs);
        await wait(delay);
        attempt += 1;
        continue;
      }

      throw await buildResponseError(response);
    } catch (err) {
      clearTimeout(timeoutId);

      const isAbortError = err instanceof DOMException && err.name === "AbortError";
      if (isAbortError && signal?.aborted) {
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= retries) {
        break;
      }

      const delay = Math.min(maxBackoffMs, initialBackoffMs * 2 ** attempt);
      await wait(delay);
      attempt += 1;
    }
  }

  throw lastError ?? new Error("fetchWithBackoff failed");
}

function computeDelay(
  response: Response,
  attempt: number,
  initialBackoffMs: number,
  maxBackoffMs: number
): number {
  const baseDelay = Math.min(maxBackoffMs, initialBackoffMs * 2 ** attempt);
  const retryAfter = response.headers.get("Retry-After");

  if (!retryAfter) {
    return baseDelay;
  }

  const parsed = Number(retryAfter);
  if (!Number.isNaN(parsed) && parsed >= 0) {
    return Math.max(baseDelay, parsed * 1000);
  }

  const retryDate = Date.parse(retryAfter);
  if (!Number.isNaN(retryDate)) {
    const now = Date.now();
    if (retryDate > now) {
      return Math.max(baseDelay, retryDate - now);
    }
  }

  return baseDelay;
}

async function buildResponseError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  const snippet = text.slice(0, 200);
  const error = new Error(
    `fetchWithBackoff failed with ${response.status}: ${snippet}`.trim()
  );
  (error as any).status = response.status;
  (error as any).statusText = response.statusText;
  (error as any).bodySnippet = snippet;
  const headers = headersToObject(response.headers);
  (error as any).responseHeaders = headers;
  const toastRequestId = response.headers.get("Toast-Request-Id") ?? headers["toast-request-id"];
  if (typeof toastRequestId === "string" && toastRequestId?.trim().length > 0) {
    (error as any).toastRequestId = toastRequestId;
  }
  return error;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jsonResponse<T>(data: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
