import type { RateLimitSnapshot } from "@/types/audit";

const MAX_RETRIES = 3;
const PER_PAGE = 100;

class GitLabApiError extends Error {
  public readonly retryAfter?: number;

  constructor(
    public readonly status: number,
    message: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = "GitLabApiError";
    this.retryAfter = retryAfter;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRateLimit(headers: Headers): RateLimitSnapshot | undefined {
  const limit = headers.get("RateLimit-Limit");
  const remaining = headers.get("RateLimit-Remaining");
  const resetAt = headers.get("RateLimit-Reset");

  if (limit && remaining && resetAt) {
    return {
      limit: Number(limit),
      remaining: Number(remaining),
      resetAt: Number(resetAt),
    };
  }
}

export function createGitLabClient(baseUrl: string, token: string) {
  async function fetchWithRetry(
    url: string,
    retriesLeft: number = MAX_RETRIES
  ): Promise<{ response: Response; rateLimit?: RateLimitSnapshot }> {
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const rateLimit = extractRateLimit(response.headers);
      return { response, rateLimit };
    }

    if (response.status === 429 && retriesLeft > 0) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : Math.pow(2, MAX_RETRIES - retriesLeft + 1) * 1000;
      await sleep(waitMs);
      return fetchWithRetry(url, retriesLeft - 1);
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    const body = await response.json().catch(() => ({}));
    const rawMessage = body.message;
    const message = typeof rawMessage === "string"
      ? rawMessage
      : rawMessage
        ? Object.values(rawMessage).flat().join("; ")
        : `GitLab API error: ${response.status}`;
    throw new GitLabApiError(
      response.status,
      message,
      retryAfterHeader ? Number(retryAfterHeader) : undefined
    );
  }

  async function fetchOne<T>(endpoint: string): Promise<{ data: T; rateLimit?: RateLimitSnapshot }> {
    const url = `${baseUrl}${endpoint}`;
    const { response, rateLimit } = await fetchWithRetry(url);
    const data: T = await response.json();
    return { data, rateLimit };
  }

  async function fetchAllPages<T>(endpoint: string): Promise<{ data: T[]; rateLimit?: RateLimitSnapshot }> {
    const results: T[] = [];
    let lastRateLimit: RateLimitSnapshot | undefined;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const separator = endpoint.includes("?") ? "&" : "?";
      const url = `${baseUrl}${endpoint}${separator}per_page=${PER_PAGE}&page=${page}`;
      const { response, rateLimit } = await fetchWithRetry(url);
      if (rateLimit) lastRateLimit = rateLimit;
      const data: T[] = await response.json();
      results.push(...data);

      const nextPage = response.headers.get("x-next-page");
      hasMore = nextPage !== null && nextPage !== "";
      if (hasMore) page = Number(nextPage);
    }

    return { data: results, rateLimit: lastRateLimit };
  }

  return { fetchOne, fetchAllPages };
}

export { GitLabApiError };