# Adaptive Rate Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read GitLab's rate limit response headers and adapt client-side throttling to stay under the actual limit for any token tier.

**Architecture:** `client.ts` extracts `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers from every GitLab API response and `Retry-After` from 429s. This info propagates through server route responses to the client hook, which uses it to compute inter-batch delays. Dead `RateLimiter` code is removed.

**Tech Stack:** Next.js API routes, React hooks, Vitest for testing.

---

## File Structure

**Modify:**
- `src/types/audit.ts` — add `RateLimitSnapshot`, update `DiscoverResult`, `MembersBatchResult`, `AuditProgress`
- `src/lib/gitlab/client.ts` — remove `RateLimiter`/`DEFAULT_RATE_LIMIT`, extract rate limit headers, update `fetchWithRetry`/`fetchOne`/`fetchAllPages` signatures, add `retryAfter` to `GitLabApiError`
- `src/lib/gitlab/members.ts` — remove `rateLimiter` params, `fetchMembersBatch` returns `rateLimit`
- `src/lib/gitlab/groups.ts` — remove `rateLimiter` param, return `rateLimit`
- `src/lib/gitlab/projects.ts` — remove `rateLimiter` param, return `rateLimit`
- `src/app/api/audit/discover/route.ts` — pass `rateLimit` in response
- `src/app/api/audit/members/route.ts` — pass `rateLimit` in response
- `src/lib/hooks/useStreamingAudit.ts` — adaptive delay based on `rateLimit`
- `src/components/LoadingIndicator.tsx` — show rate-limited phase
- Test files (update mocks, add new tests)

**Delete:**
- Nothing (dead `RateLimiter` code removed inline)

---

### Task 1: Add `RateLimitSnapshot` type and update audit types

**Files:**
- Modify: `src/types/audit.ts`

- [ ] **Step 1: Add new types to audit.ts**

Append after the existing `AuditProgress` interface:

```ts
export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}
```

Update `DiscoverResult` to:

```ts
export interface DiscoverResult {
  groups: { id: number; fullPath: string; name: string }[];
  projects: { id: number; fullPath: string; name: string }[];
  rateLimit?: RateLimitSnapshot;
}
```

Update `MembersBatchResult` to:

```ts
export interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: { id: number; username: string; name: string; accessLevel: number }[];
  }>;
  rateLimit?: RateLimitSnapshot;
}
```

Update `AuditProgress` to:

```ts
export interface AuditProgress {
  current: number;
  total: number;
  phase: "discovering" | "fetching-members" | "aggregating" | "rate-limited";
  rateLimitRemaining?: number;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/types/audit.ts
git commit -m "feat: add RateLimitSnapshot type and update audit types for adaptive rate limiting"
```

---

### Task 2: Update `client.ts` — remove dead code, extract rate limit headers, fix 429 retry

**Files:**
- Modify: `src/lib/gitlab/client.ts`
- Modify: `src/lib/gitlab/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/lib/gitlab/__tests__/client.test.ts`:

```ts
describe("rate limit headers", () => {
  it("fetchOne returns rate limit info from response headers", async () => {
    const headers = new Headers();
    headers.set("RateLimit-Limit", "500");
    headers.set("RateLimit-Remaining", "498");
    headers.set("RateLimit-Reset", "1700000000");

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 1, name: "test" }),
          headers,
        } as Response)
      )
    );

    const client = createGitLabClient(baseUrl, token);
    const { data, rateLimit } = await client.fetchOne<{ id: number; name: string }>("/groups/1");
    expect(data).toEqual({ id: 1, name: "test" });
    expect(rateLimit).toEqual({ limit: 500, remaining: 498, resetAt: 1700000000 });
  });

  it("fetchAllPages returns rate limit from last page", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        const headers = new Headers();
        if (callCount === 1) {
          headers.set("x-next-page", "2");
          headers.set("RateLimit-Limit", "500");
          headers.set("RateLimit-Remaining", "490");
          headers.set("RateLimit-Reset", "1700000000");
        } else {
          headers.set("RateLimit-Limit", "500");
          headers.set("RateLimit-Remaining", "485");
          headers.set("RateLimit-Reset", "1700000000");
        }
        const data = callCount === 1 ? [{ id: 1 }] : [{ id: 2 }];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          headers,
        } as Response);
      })
    );

    const client = createGitLabClient(baseUrl, token);
    const { data, rateLimit } = await client.fetchAllPages<{ id: number }>("/groups");
    expect(data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rateLimit?.remaining).toBe(485);
  });

  it("returns undefined rateLimit when headers are absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 1 }),
          headers: new Headers(),
        } as Response)
      )
    );

    const client = createGitLabClient(baseUrl, token);
    const { rateLimit } = await client.fetchOne<{ id: number }>("/groups/1");
    expect(rateLimit).toBeUndefined();
  });
});

describe("429 retry with Retry-After header", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses Retry-After header for wait time on 429", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          const headers = new Headers();
          headers.set("Retry-After", "5");
          return Promise.resolve({
            ok: false,
            status: 429,
            json: () => Promise.resolve({ message: "rate limited" }),
            headers,
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: 1 }]),
          headers: new Headers(),
        } as Response);
      })
    );

    const client = createGitLabClient(baseUrl, token);
    const promise = client.fetchAllPages<{ id: number }>("/groups");
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result.data).toEqual([{ id: 1 }]);
    expect(callCount).toBe(2);
  });

  it("GitLabApiError includes retryAfter on 429", async () => {
    const headers = new Headers();
    headers.set("Retry-After", "10");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ message: "rate limited" }),
          headers,
        } as Response)
      )
    );

    const client = createGitLabClient(baseUrl, token);
    const { GitLabApiError } = await import("../client");
    try {
      await client.fetchAllPages("/groups");
    } catch (err) {
      expect(err).toBeInstanceOf(GitLabApiError);
      expect((err as any).retryAfter).toBe(10);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/gitlab/__tests__/client.test.ts`
Expected: FAIL — `fetchOne` and `fetchAllPages` don't return `{ data, rateLimit }`, `GitLabApiError` doesn't have `retryAfter`

- [ ] **Step 3: Update client.ts**

Replace the entire file with:

```ts
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
```

- [ ] **Step 4: Update existing client tests to match new return shape**

The existing tests use `client.fetchAllPages("/groups")` and expect `[{ id: 1 }]` directly. They now need to destructure `{ data }`. Update all existing test expectations:

In `src/lib/gitlab/__tests__/client.test.ts`, update the existing tests:

Change `const result = await client.fetchAllPages<...>(...)` to `const { data: result } = await client.fetchAllPages<...>(...)`.

Change `const result = await client.fetchOne<...>(...)` to `const { data: result } = await client.fetchOne<...>(...)`.

This applies to these specific lines in the test file:
- Line 27: `const result = await client.fetchAllPages<{ id: number }>("/groups");` → `const { data: result } = await client.fetchAllPages<{ id: number }>("/groups");`
- Line 52-53: Similar destructuring for the pagination test
- Line 71: `const result = await client.fetchOne<{ id: number; name: string }>("/groups/1");` → `const { data: result } = await client.fetchOne<{ id: number; name: string }>("/groups/1");`
- Line 164-166: The 429 retry test — `const result = await promise;` → `const { data: result } = await promise;`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/gitlab/__tests__/client.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/gitlab/client.ts src/lib/gitlab/__tests__/client.test.ts
git commit -m "feat: extract rate limit headers from GitLab responses, remove RateLimiter dead code"
```

---

### Task 3: Update `members.ts`, `groups.ts`, `projects.ts` — remove `rateLimiter` params, return `rateLimit`

**Files:**
- Modify: `src/lib/gitlab/members.ts`
- Modify: `src/lib/gitlab/groups.ts`
- Modify: `src/lib/gitlab/projects.ts`
- Modify: `src/lib/gitlab/__tests__/members-batch.test.ts`
- Modify: `src/lib/gitlab/__tests__/members.test.ts`
- Modify: `src/lib/gitlab/__tests__/groups.test.ts`
- Modify: `src/lib/gitlab/__tests__/projects.test.ts`

- [ ] **Step 1: Write the failing test for fetchMembersBatch returning rateLimit**

Add to `src/lib/gitlab/__tests__/members-batch.test.ts`:

```ts
it("returns rate limit info from the client", async () => {
  const mockClient = {
    fetchAllPages: vi.fn().mockResolvedValue({
      data: [{ id: 1, username: "alice", name: "Alice", access_level: 30 }],
      rateLimit: { limit: 500, remaining: 495, resetAt: 1700000000 },
    }),
  };
  vi.mocked(createGitLabClient).mockReturnValue(mockClient as any);

  const result = await fetchMembersBatch(
    [{ type: "group" as const, id: 42, fullPath: "my-group" }],
    "https://gitlab.com/api/v4",
    "test-token"
  );

  expect(result.rateLimit).toEqual({ limit: 500, remaining: 495, resetAt: 1700000000 });
});
```

Run: `npx vitest run src/lib/gitlab/__tests__/members-batch.test.ts`
Expected: FAIL — `result.rateLimit` is undefined

- [ ] **Step 2: Update members.ts**

Replace `src/lib/gitlab/members.ts` with:

```ts
import { createGitLabClient } from "./client";
import type { GitLabGroup } from "./groups";
import type { GitLabProject } from "./projects";
import type { RateLimitSnapshot } from "@/types/audit";

const BATCH_SIZE = 15;

export interface GitLabMember {
  id: number;
  username: string;
  name: string;
  accessLevel: number;
}

export interface GroupMembersResult {
  groupId: number;
  groupFullPath: string;
  members: GitLabMember[];
}

export interface ProjectMembersResult {
  projectId: number;
  projectFullPath: string;
  members: GitLabMember[];
}

export interface MemberResource {
  type: "group" | "project";
  id: number;
  fullPath: string;
}

export interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: GitLabMember[];
  }>;
  rateLimit?: RateLimitSnapshot;
}

async function fetchInBatches(
  items: { id: number; fullPath: string }[],
  endpointFn: (id: number) => string,
  baseUrl: string,
  token: string
): Promise<{ id: number; fullPath: string; members: GitLabMember[] }[]> {
  const client = createGitLabClient(baseUrl, token);
  const results: { id: number; fullPath: string; members: GitLabMember[] }[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const { data: raw } = await client.fetchAllPages<{
          id: number;
          username: string;
          name: string;
          access_level: number;
        }>(endpointFn(item.id));

        return {
          id: item.id,
          fullPath: item.fullPath,
          members: raw.map((m) => ({
            id: m.id,
            username: m.username,
            name: m.name,
            accessLevel: m.access_level,
          })),
        };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

export async function fetchGroupMembers(
  groups: GitLabGroup[],
  baseUrl: string,
  token: string
): Promise<GroupMembersResult[]> {
  const results = await fetchInBatches(
    groups.map((g) => ({ id: g.id, fullPath: g.fullPath })),
    (id) => `/groups/${id}/members/all`,
    baseUrl,
    token
  );

  return results.map((r) => ({
    groupId: r.id,
    groupFullPath: r.fullPath,
    members: r.members,
  }));
}

export async function fetchProjectMembers(
  projects: GitLabProject[],
  baseUrl: string,
  token: string
): Promise<ProjectMembersResult[]> {
  const results = await fetchInBatches(
    projects.map((p) => ({ id: p.id, fullPath: p.fullPath })),
    (id) => `/projects/${id}/members/all`,
    baseUrl,
    token
  );

  return results.map((r) => ({
    projectId: r.id,
    projectFullPath: r.fullPath,
    members: r.members,
  }));
}

export async function fetchMembersBatch(
  resources: MemberResource[],
  baseUrl: string,
  token: string
): Promise<MembersBatchResult> {
  const client = createGitLabClient(baseUrl, token);
  let lastRateLimit: RateLimitSnapshot | undefined;

  const results = await Promise.all(
    resources.map(async (resource) => {
      const endpoint = resource.type === "group"
        ? `/groups/${resource.id}/members/all`
        : `/projects/${resource.id}/members/all`;

      const { data: raw, rateLimit } = await client.fetchAllPages<{
        id: number;
        username: string;
        name: string;
        access_level: number;
      }>(endpoint);

      if (rateLimit) lastRateLimit = rateLimit;

      return {
        id: resource.id,
        fullPath: resource.fullPath,
        members: raw.map((m) => ({
          id: m.id,
          username: m.username,
          name: m.name,
          accessLevel: m.access_level,
        })),
      };
    })
  );

  return { results, rateLimit: lastRateLimit };
}
```

- [ ] **Step 3: Update groups.ts**

Replace `src/lib/gitlab/groups.ts` with:

```ts
import { createGitLabClient } from "./client";
import type { RateLimitSnapshot } from "@/types/audit";

export interface GitLabGroup {
  id: number;
  fullPath: string;
  name: string;
}

export async function fetchGroupHierarchy(
  groupId: string,
  baseUrl: string,
  token: string
): Promise<{ groups: GitLabGroup[]; rateLimit?: RateLimitSnapshot }> {
  const client = createGitLabClient(baseUrl, token);
  let lastRateLimit: RateLimitSnapshot | undefined;

  const [{ data: topGroup, rateLimit: rl1 }, { data: descendantsRaw, rateLimit: rl2 }] = await Promise.all([
    client.fetchOne<{
      id: number;
      full_path: string;
      name: string;
    }>(`/groups/${groupId}`),
    client.fetchAllPages<{
      id: number;
      full_path: string;
      name: string;
    }>(`/groups/${groupId}/descendant_groups`),
  ]);

  if (rl1) lastRateLimit = rl1;
  if (rl2) lastRateLimit = rl2;

  const normalize = (g: { id: number; full_path: string; name: string }): GitLabGroup => ({
    id: g.id,
    fullPath: g.full_path,
    name: g.name,
  });

  return { groups: [normalize(topGroup), ...descendantsRaw.map(normalize)], rateLimit: lastRateLimit };
}
```

- [ ] **Step 4: Update projects.ts**

Replace `src/lib/gitlab/projects.ts` with:

```ts
import { createGitLabClient } from "./client";
import type { RateLimitSnapshot } from "@/types/audit";

export interface GitLabProject {
  id: number;
  fullPath: string;
  name: string;
}

export async function fetchProjectsInHierarchy(
  groupId: string,
  baseUrl: string,
  token: string
): Promise<{ projects: GitLabProject[]; rateLimit?: RateLimitSnapshot }> {
  const client = createGitLabClient(baseUrl, token);

  const { data: raw, rateLimit } = await client.fetchAllPages<{
    id: number;
    path_with_namespace: string;
    name: string;
  }>(`/groups/${groupId}/projects?include_subgroups=true&simple=true`);

  const projects = raw.map((p) => ({
    id: p.id,
    fullPath: p.path_with_namespace,
    name: p.name,
  }));

  return { projects, rateLimit };
}
```

- [ ] **Step 5: Update test mocks for client return shape**

In `src/lib/gitlab/__tests__/members-batch.test.ts`, the `fetchAllPages` mock returns `[{ id: 1, ... }]` directly. It now needs to return `{ data: [...], rateLimit: undefined }`. Also remove the `RateLimiter` mock. Update the mock and tests:

```ts
vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

import { createGitLabClient } from "../client";
```

Every `mockResolvedValue` for `fetchAllPages` needs to wrap the data:
`mockResolvedValue([{ id: 1, ... }])` → `mockResolvedValue({ data: [{ id: 1, ... }], rateLimit: undefined })`

Similarly in `src/lib/gitlab/__tests__/members.test.ts`, `src/lib/gitlab/__tests__/groups.test.ts`, `src/lib/gitlab/__tests__/projects.test.ts`: remove `RateLimiter` mocks and update `fetchAllPages`/`fetchOne` return shapes.

- [ ] **Step 6: Update groups and projects tests**

`src/lib/gitlab/__tests__/groups.test.ts` — `fetchGroupHierarchy` now returns `{ groups: [...], rateLimit? }` instead of `GitLabGroup[]`. Update the mock to match and the destructuring in the test.

`src/lib/gitlab/__tests__/projects.test.ts` — `fetchProjectsInHierarchy` now returns `{ projects: [...], rateLimit? }` instead of `GitLabProject[]`. Same update.

- [ ] **Step 7: Run all gitlab tests**

Run: `npx vitest run src/lib/gitlab/__tests__/`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/gitlab/members.ts src/lib/gitlab/groups.ts src/lib/gitlab/projects.ts src/lib/gitlab/__tests__/members-batch.test.ts src/lib/gitlab/__tests__/members.test.ts src/lib/gitlab/__tests__/groups.test.ts src/lib/gitlab/__tests__/projects.test.ts
git commit -m "feat: return rate limit info from GitLab API functions, remove rateLimiter params"
```

---

### Task 4: Update API routes to return `rateLimit` in responses

**Files:**
- Modify: `src/app/api/audit/discover/route.ts`
- Modify: `src/app/api/audit/members/route.ts`
- Modify: `src/app/api/audit/discover/__tests__/route.test.ts`
- Modify: `src/app/api/audit/members/__tests__/route.test.ts`

- [ ] **Step 1: Update discover route**

Replace `src/app/api/audit/discover/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";

const GITLAB_BASE_URL = "https://gitlab.com/api/v4";

export async function POST(request: NextRequest) {
  let body: { groupId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { groupId, token } = body;

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  const gitlabToken = token || process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    return NextResponse.json({ error: "No access token provided" }, { status: 400 });
  }

  try {
    const [{ groups, rateLimit: groupsRateLimit }, { projects, rateLimit: projectsRateLimit }] = await Promise.all([
      fetchGroupHierarchy(groupId, GITLAB_BASE_URL, gitlabToken),
      fetchProjectsInHierarchy(groupId, GITLAB_BASE_URL, gitlabToken),
    ]);

    const rateLimit = projectsRateLimit ?? groupsRateLimit;

    return NextResponse.json({ groups, projects, rateLimit });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
    const message = err instanceof Error ? err.message : "Failed to reach GitLab API";

    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 2: Update members route**

Replace `src/app/api/audit/members/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchMembersBatch, MemberResource } from "@/lib/gitlab/members";

const GITLAB_BASE_URL = "https://gitlab.com/api/v4";
const MAX_BATCH_SIZE = 5;

export async function POST(request: NextRequest) {
  let body: { resources?: MemberResource[]; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { resources, token } = body;

  if (!resources || !Array.isArray(resources)) {
    return NextResponse.json({ error: "Resources array is required" }, { status: 400 });
  }

  if (resources.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: "Resource batch exceeds maximum size of 5" }, { status: 400 });
  }

  const gitlabToken = token || process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    return NextResponse.json({ error: "No access token provided" }, { status: 400 });
  }

  try {
    const { results, rateLimit } = await fetchMembersBatch(resources, GITLAB_BASE_URL, gitlabToken);
    return NextResponse.json({ results, rateLimit });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
    const message = err instanceof Error ? err.message : "Failed to reach GitLab API";
    const retryAfter = err && typeof err === "object" && "retryAfter" in err
      ? (err as { retryAfter: number }).retryAfter
      : undefined;

    return NextResponse.json({ error: message, retryAfter }, { status });
  }
}
```

- [ ] **Step 3: Update discover route tests**

Update tests in `src/app/api/audit/discover/__tests__/route.test.ts`: the mocks for `fetchGroupHierarchy` and `fetchProjectsInHierarchy` now return `{ groups: [...], rateLimit: undefined }` and `{ projects: [...], rateLimit: undefined }` respectively. Update mock return values:

```ts
vi.mocked(fetchGroupHierarchy).mockResolvedValue({ groups, rateLimit: undefined });
vi.mocked(fetchProjectsInHierarchy).mockResolvedValue({ projects, rateLimit: undefined });
```

Add a test for rate limit passthrough:

```ts
it("returns rate limit info when available", async () => {
  const groups = [{ id: 1, fullPath: "g", name: "G" }];
  const projects = [{ id: 10, fullPath: "g/p", name: "P" }];
  const rateLimit = { limit: 500, remaining: 490, resetAt: 1700000000 };

  vi.mocked(fetchGroupHierarchy).mockResolvedValue({ groups, rateLimit });
  vi.mocked(fetchProjectsInHierarchy).mockResolvedValue({ projects, rateLimit: undefined });

  const response = await POST(createRequest({ groupId: "1" }));
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.rateLimit).toEqual(rateLimit);
});
```

- [ ] **Step 4: Update members route tests**

Update mocks in `src/app/api/audit/members/__tests__/route.test.ts`: `fetchMembersBatch` now returns `{ results: [...], rateLimit: undefined }`. Update mock return values:

```ts
vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [...], rateLimit: undefined });
```

Add a test for rate limit passthrough:

```ts
it("returns rate limit info when available", async () => {
  const rateLimit = { limit: 500, remaining: 480, resetAt: 1700000000 };
  vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [], rateLimit } as any);

  const response = await POST(createRequest({
    resources: [{ type: "group", id: 1, fullPath: "g" }],
  }));
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.rateLimit).toEqual(rateLimit);
});
```

- [ ] **Step 5: Run all API route tests**

Run: `npx vitest run src/app/api/audit/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/audit/discover/ src/app/api/audit/members/
git commit -m "feat: return rate limit info in API route responses"
```

---

### Task 5: Update `useStreamingAudit` hook with adaptive delay

**Files:**
- Modify: `src/lib/hooks/useStreamingAudit.ts`
- Modify: `src/lib/hooks/__tests__/useStreamingAudit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/hooks/__tests__/useStreamingAudit.test.ts`:

```ts
it("waits for rate limit reset when remaining is low", async () => {
  vi.useFakeTimers();
  const groups = [{ id: 1, fullPath: "g", name: "G" }];
  const members = [{ id: 1, username: "alice", name: "Alice", accessLevel: 30 }];

  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + 5;
  const rateLimit = { limit: 500, remaining: 10, resetAt };

  vi.mocked(aggregateUsers).mockReturnValue([{ id: 1, name: "Alice", username: "alice", groups: [], projects: [] }] as any);

  let membersCallCount = 0;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/audit/discover")) {
      return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [], rateLimit }) } as Response;
    }
    if (url.includes("/api/audit/members")) {
      membersCallCount++;
      return { ok: true, status: 200, json: () => Promise.resolve({ results: [{ id: 1, fullPath: "g", members }], rateLimit }) } as Response;
    }
    return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
  });

  const { result } = renderHook(() => useStreamingAudit());

  act(() => {
    result.current.trigger({ groupId: "1" });
  });

  await vi.advanceTimersByTimeAsync(10000);

  await waitFor(() => expect(result.current.isLoading).toBe(false));

  vi.useRealTimers();
});
```

- [ ] **Step 2: Update the hook**

Replace `src/lib/hooks/useStreamingAudit.ts` with:

```ts
"use client";

import { useState, useRef, useCallback } from "react";
import type { AuditResult, AuditProgress, DiscoverResult, MembersBatchResult, RateLimitSnapshot } from "@/types/audit";
import type { GroupMembersResult, ProjectMembersResult } from "@/lib/gitlab/members";
import { aggregateUsers } from "@/lib/gitlab/aggregate";

interface AuditArgs {
  groupId: string;
  token?: string;
}

const BATCH_SIZE = 5;
const BASE_DELAY_MS = 2000;
const RATE_LIMIT_THRESHOLD = 30;

let interBatchDelayMs = BASE_DELAY_MS;

export function setInterBatchDelay(ms: number) {
  interBatchDelayMs = ms;
}

async function postJSON<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.error ?? "Unknown error");
    if (data.retryAfter) {
      (err as any).retryAfter = data.retryAfter;
    }
    throw err;
  }

  return data as T;
}

function computeDelay(rateLimit?: RateLimitSnapshot): number {
  if (!rateLimit || rateLimit.remaining >= RATE_LIMIT_THRESHOLD) {
    return interBatchDelayMs;
  }

  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = Math.max(0, rateLimit.resetAt - now + 1);
  return waitSeconds * 1000;
}

export function useStreamingAudit() {
  const [data, setData] = useState<AuditResult | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const abortRef = useRef(false);
  const rateLimitRef = useRef<RateLimitSnapshot | undefined>();

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
    setProgress(null);
    abortRef.current = false;
    rateLimitRef.current = undefined;
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const trigger = useCallback(async (args: AuditArgs) => {
    abortRef.current = false;
    setData(undefined);
    setError(undefined);
    setIsLoading(true);
    setProgress(null);
    rateLimitRef.current = undefined;

    try {
      const token = args.token || undefined;

      setProgress({ current: 0, total: 0, phase: "discovering" });
      const discoverResult = await postJSON<DiscoverResult>("/api/audit/discover", {
        groupId: args.groupId,
        token,
      });

      if (discoverResult.rateLimit) {
        rateLimitRef.current = discoverResult.rateLimit;
      }

      if (abortRef.current) {
        setIsLoading(false);
        setProgress(null);
        return;
      }

      const allResources = [
        ...discoverResult.groups.map((g) => ({ type: "group" as const, id: g.id, fullPath: g.fullPath })),
        ...discoverResult.projects.map((p) => ({ type: "project" as const, id: p.id, fullPath: p.fullPath })),
      ];

      const total = allResources.length;
      const allGroupMembers: GroupMembersResult[] = [];
      const allProjectMembers: ProjectMembersResult[] = [];

      for (let i = 0; i < total; i += BATCH_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 0));

        if (abortRef.current) {
          setIsLoading(false);
          setProgress(null);
          return;
        }

        const batch = allResources.slice(i, i + BATCH_SIZE);

        const batchResult = await postJSON<MembersBatchResult>("/api/audit/members", {
          resources: batch,
          token,
        });

        if (batchResult.rateLimit) {
          rateLimitRef.current = batchResult.rateLimit;
        }

        batch.forEach((resource, idx) => {
          const result = batchResult.results[idx];
          if (!result) return;

          if (resource.type === "group") {
            allGroupMembers.push({ groupId: result.id, groupFullPath: result.fullPath, members: result.members });
          } else {
            allProjectMembers.push({ projectId: result.id, projectFullPath: result.fullPath, members: result.members });
          }
        });

        const users = aggregateUsers(allGroupMembers, allProjectMembers);
        setData({ users, totalUsers: users.length });

        const completedCount = Math.min(i + BATCH_SIZE, total);
        setProgress({
          current: completedCount,
          total,
          phase: "fetching-members",
          rateLimitRemaining: rateLimitRef.current?.remaining,
        });

        if (i + BATCH_SIZE < total) {
          const delay = computeDelay(rateLimitRef.current);
          if (delay > interBatchDelayMs) {
            setProgress((prev) => prev ? { ...prev, phase: "rate-limited" as const } : prev);
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      setProgress(null);
    } catch (err) {
      const retryAfter = (err as any).retryAfter;
      if (retryAfter) {
        setProgress((prev) => prev ? { ...prev, phase: "rate-limited" as const } : prev);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      }
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { trigger, abort, data, error, isLoading, progress, reset };
}
```

- [ ] **Step 3: Update existing hook tests**

The tests mock `fetch` responses. The members endpoint now returns `{ results: [...], rateLimit: undefined }` in the default case. Update mock return values to include `rateLimit: undefined` where it's missing. Also update test mock for discover to return `rateLimit: undefined`.

- [ ] **Step 4: Run hook tests**

Run: `npx vitest run src/lib/hooks/__tests__/useStreamingAudit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks/useStreamingAudit.ts src/lib/hooks/__tests__/useStreamingAudit.test.ts
git commit -m "feat: add adaptive rate limit delay to useStreamingAudit hook"
```

---

### Task 6: Update `LoadingIndicator` for rate-limited phase

**Files:**
- Modify: `src/components/LoadingIndicator.tsx`

- [ ] **Step 1: Update LoadingIndicator**

Replace `src/components/LoadingIndicator.tsx` with:

```tsx
import type { AuditProgress } from "@/types/audit";

interface LoadingIndicatorProps {
  progress?: AuditProgress | null;
}

export function LoadingIndicator({ progress }: LoadingIndicatorProps) {
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const statusText = progress?.phase === "rate-limited"
    ? `Waiting for rate limit reset...`
    : progress?.phase === "fetching-members"
      ? `Fetching members... ${pct}%${progress.rateLimitRemaining !== undefined ? ` · ${progress.rateLimitRemaining} remaining` : ""}`
      : progress?.phase === "discovering"
        ? "Discovering groups and projects..."
        : progress?.phase === "aggregating"
          ? "Aggregating results..."
          : "Fetching members from GitLab";

  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
      </div>
      <div className="mt-5 text-center">
        <p className="text-sm font-medium text-foreground">{statusText}</p>
        {(progress?.phase === "fetching-members" || progress?.phase === "rate-limited") && (
          <div className="mt-2 w-48 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                progress?.phase === "rate-limited" ? "bg-amber-500" : "bg-accent"
              }`}
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/LoadingIndicator.tsx
git commit -m "feat: show rate-limited phase in LoadingIndicator"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit any remaining fixes if needed**