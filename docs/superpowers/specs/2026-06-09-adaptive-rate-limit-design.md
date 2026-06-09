# Adaptive Rate Limit Design

**Date:** 2026-06-09
**Status:** Approved

## 1. Problem

The streaming audit hits GitLab's rate limit on the second members batch. Root cause: within a single batch of 5 resources, `fetchMembersBatch` fires 5-15 GitLab API calls via `Promise.all` with no throttling. A burst of 10+ calls in ~1 second exceeds GitLab's rolling per-minute window (500 req/min on free tier).

Additional issues:
- The `RateLimiter` class in `client.ts` is dead code — never instantiated in production
- 429 retry uses fixed 1s/2s/3s backoff, ignoring GitLab's `Retry-After` header
- No code reads GitLab's `RateLimit-Remaining` or `RateLimit-Reset` headers
- The client has no visibility into how close it is to the limit

## 2. Architecture

Read GitLab's rate limit response headers on every API call. Thread that info back to the client so it can adapt inter-batch delays. Use `Retry-After` for 429 backoff instead of fixed values. Remove dead `RateLimiter` code.

```
GitLab API response
  ├─ Headers: RateLimit-Remaining, RateLimit-Reset, Retry-After
  ▼
client.ts fetchWithRetry()
  ├─ Reads RateLimit-* headers from every response
  ├─ On 429: reads Retry-After for wait time
  ├─ Returns rate limit snapshot alongside data
  ▼
API routes (discover, members)
  ├─ Include rateLimit in JSON response
  ▼
useStreamingAudit hook
  ├─ Reads rateLimit from each batch response
  ├─ If remaining < 30: waits until resetAt + 1s
  ├─ If remaining >= 30: uses base delay (2s)
  ├─ Shows "Waiting for rate limit reset..." while paused
```

## 3. Type Changes

```ts
// New
export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds) from RateLimit-Reset
}

// Updated — optional rateLimit added
export interface DiscoverResult {
  groups: { id: number; fullPath: string; name: string }[];
  projects: { id: number; fullPath: string; name: string }[];
  rateLimit?: RateLimitSnapshot;
}

export interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: { id: number; username: string; name: string; accessLevel: number }[];
  }>;
  rateLimit?: RateLimitSnapshot;
}

export interface AuditProgress {
  current: number;
  total: number;
  phase: "discovering" | "fetching-members" | "aggregating" | "rate-limited";
  rateLimitRemaining?: number;
}
```

## 4. Component Changes

### `client.ts`

- Remove `RateLimiter` class, `DEFAULT_RATE_LIMIT` constant, `rateLimiter` parameter from `createGitLabClient`
- `fetchWithRetry` reads `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers from every successful response
- Returns `{ data, rateLimit }` — the rate limit snapshot from the response
- 429 retry reads `Retry-After` header for wait time; falls back to exponential backoff (2s, 4s, 8s) if absent
- `fetchAllPages` returns `{ data: T[], rateLimit: RateLimitSnapshot }` — snapshot from the last page's response

### `fetchMembersBatch` and `fetchGroupHierarchy` / `fetchProjectsInHierarchy`

- Remove `rateLimiter` parameter from all function signatures
- Return rate limit snapshot alongside data
- For `fetchMembersBatch` (5 resources in `Promise.all`): use the snapshot from whichever response resolved last (most conservative remaining count)

### API routes

- `/api/audit/discover` returns `{ groups, projects, rateLimit }`
- `/api/audit/members` returns `{ results: [...], rateLimit }`
- `/api/audit/aggregate` — no change (no GitLab API calls)

### `useStreamingAudit` hook

Adaptive delay after each batch:

- If `rateLimit.remaining >= 30` or no rate limit info: use base delay (2s)
- If `rateLimit.remaining < 30`: compute wait until `resetAt` + 1s safety margin
- If a 429 error occurs: extract `Retry-After` from error context and wait that exact duration
- While waiting for rate limit reset, set `progress.phase = "rate-limited"` so UI shows status

### `LoadingIndicator`

- When `phase === "rate-limited"`: show "Waiting for rate limit reset..." with a countdown indicator
- When `phase === "fetching-members"`: show remaining quota if available ("Fetching members... 14% · 342 remaining")

## 5. Dead Code Removal

- `RateLimiter` class
- `DEFAULT_RATE_LIMIT` constant
- `rateLimiter` parameter from: `createGitLabClient`, `fetchGroupHierarchy`, `fetchProjectsInHierarchy`, `fetchGroupMembers`, `fetchProjectMembers`, `fetchInBatches`, `fetchMembersBatch`
- Any `RateLimiter` imports in route handlers and test mocks

## 6. Tier Adaptation

The design works with any GitLab tier because it reads the actual limit from response headers:
- Free tier (500 req/min): headers say 500, client slows down when remaining is low
- Premium tier (2,000 req/min): headers say 2000, client doesn't need to slow down
- Self-hosted with custom limits: headers reflect those limits

No tier-specific configuration is needed.

## 7. Error Handling

429 retry in `fetchWithRetry`:
```
429 → read Retry-After header
  ├─ present: wait Retry-After seconds → retry
  └─ absent: wait 2^attempt seconds (2s, 4s, 8s) → retry
After 3 retries → throw GitLabApiError(429, message including reset time, retryAfter)
```

`GitLabApiError` gains an optional `retryAfter?: number` field populated from the `Retry-After` header on 429 responses.

If the hook catches a 429 error:
- The `GitLabApiError` carries a `retryAfter` field (seconds, extracted from the `Retry-After` header during the final retry)
- Wait `retryAfter` seconds before retrying the same batch
- If `retryAfter` is absent, wait until `rateLimit.resetAt` from the last successful batch
- After 2 batch-level retries, give up and show the error to the user

## 8. What Stays the Same

- `useStreamingAudit` hook interface (trigger, abort, data, error, isLoading, progress, reset)
- Incremental aggregation (users appear as batches complete)
- Batch size of 5 resources
- `PER_PAGE = 100` for pagination
- `aggregateUsers` called locally in the client