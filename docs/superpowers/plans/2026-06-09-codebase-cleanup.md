# Codebase Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead code, consolidate duplicate types, refactor error handling into a shared utility, fix all 23 lint issues, and eliminate a module-level mutable variable.

**Architecture:** Create a shared `errors.ts` module for `GitLabApiError` and `handleApiError`, consolidate types into `audit.ts`, remove dead exports/CSS, replace the module-level mutable with a React ref, and type all test mocks properly.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, ESLint

**Grill decisions applied:**
- Hook catch block uses `instanceof GitLabApiError` directly (not `handleApiError`)
- `initialDelay` lives only on `trigger`, not on the hook constructor
- Remove `GitLabMember` interface from `members.ts` entirely
- No re-export of `GitLabApiError` from `client.ts` — test imports `../errors` directly
- `computeDelay` is a pure function with `(rateLimit, baseDelay)` explicit args
- Mock client typing uses `as unknown as ReturnType<typeof createGitLabClient>`

---

### Task 1: Create shared error-handling module

**Files:**
- Create: `src/lib/gitlab/errors.ts`

- [ ] **Step 1: Create `src/lib/gitlab/errors.ts`**

```ts
export class GitLabApiError extends Error {
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

interface ErrorInfo {
  status: number;
  message: string;
  retryAfter?: number;
}

export function handleApiError(err: unknown): ErrorInfo {
  if (err instanceof GitLabApiError) {
    return { status: err.status, message: err.message, retryAfter: err.retryAfter };
  }
  const status =
    err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
  const retryAfter =
    err && typeof err === "object" && "retryAfter" in err
      ? (err as { retryAfter: number }).retryAfter
      : undefined;
  const message =
    err instanceof Error ? err.message : "Failed to reach GitLab API";
  return { status, message, retryAfter };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/gitlab/errors.ts
git commit -m "feat: add shared error-handling module with GitLabApiError and handleApiError"
```

---

### Task 2: Move GitLabApiError out of client.ts

**Files:**
- Modify: `src/lib/gitlab/client.ts`
- Modify: `src/lib/gitlab/__tests__/client.test.ts`

- [ ] **Step 1: Update `client.ts` — remove GitLabApiError class, import from errors.ts, no re-export**

Replace the entire `GitLabApiError` class definition (lines 6–18) and the `export { GitLabApiError }` at line 109 with just an import:

```ts
import { GitLabApiError } from "./errors";
```

Do NOT add a re-export. The resulting `client.ts` should look like:

```ts
import type { RateLimitSnapshot } from "@/types/audit";
import { GitLabApiError } from "./errors";

const MAX_RETRIES = 3;
const PER_PAGE = 100;

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
```

- [ ] **Step 2: Update `client.test.ts` — change import to `../errors` and replace `(caught as any).retryAfter`**

In `src/lib/gitlab/__tests__/client.test.ts`:

Change the dynamic import on line 239:
```ts
const { GitLabApiError } = await import("../client");
```
to:
```ts
const { GitLabApiError } = await import("../errors");
```

Replace line 249:
```ts
expect((caught as any).retryAfter).toBe(10);
```
with:
```ts
expect((caught as GitLabApiError).retryAfter).toBe(10);
```

Update the test to import `GitLabApiError` at the top level. Change line 2:
```ts
import { createGitLabClient } from "../client";
```
to:
```ts
import { createGitLabClient } from "../client";
import { GitLabApiError } from "../errors";
```

Then change line 248:
```ts
expect(caught).toBeInstanceOf(GitLabApiError);
```
stays the same (now uses the top-level import).

And line 249:
```ts
expect((caught as GitLabApiError).retryAfter).toBe(10);
```

Remove the dynamic import on line 239:
```ts
const { GitLabApiError } = await import("../errors");
```
(since it's now imported at the top).

- [ ] **Step 3: Run tests to verify**

Run: `npx vitest run src/lib/gitlab/__tests__/client.test.ts`
Expected: All tests pass

- [ ] **Step 4: Run lint to verify no new issues**

Run: `npm run lint`
Expected: Same or fewer errors than before

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/client.ts src/lib/gitlab/__tests__/client.test.ts
git commit -m "refactor: move GitLabApiError to shared errors module, update test import"
```

---

### Task 3: Use handleApiError in API routes

**Files:**
- Modify: `src/app/api/audit/discover/route.ts`
- Modify: `src/app/api/audit/members/route.ts`

- [ ] **Step 1: Update `discover/route.ts`**

Replace the catch block (lines 33–40) with `handleApiError`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";
import { handleApiError } from "@/lib/gitlab/errors";
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
    const [{ groups, rateLimit: rl1 }, { projects, rateLimit: rl2 }] = await Promise.all([
      fetchGroupHierarchy(groupId, GITLAB_BASE_URL, gitlabToken),
      fetchProjectsInHierarchy(groupId, GITLAB_BASE_URL, gitlabToken),
    ]);

    return NextResponse.json({ groups, projects, rateLimit: rl2 ?? rl1 });
  } catch (err: unknown) {
    const { status, message } = handleApiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 2: Update `members/route.ts`**

Replace the catch block (lines 34–44) with `handleApiError`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchMembersBatch, MemberResource } from "@/lib/gitlab/members";
import { handleApiError } from "@/lib/gitlab/errors";

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
    const { status, message, retryAfter } = handleApiError(err);
    return NextResponse.json({ error: message, retryAfter }, { status });
  }
}
```

- [ ] **Step 3: Run route tests**

Run: `npx vitest run src/app/api/audit/`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/app/api/audit/discover/route.ts src/app/api/audit/members/route.ts
git commit -m "refactor: replace duck-typed error handling in API routes with handleApiError"
```

---

### Task 4: Use GitLabApiError in useStreamingAudit hook directly (not handleApiError)

**Files:**
- Modify: `src/lib/hooks/useStreamingAudit.ts`

This task replaces `(err as any).retryAfter` in the hook. Since `postJSON` throws `GitLabApiError`, the catch block uses `instanceof GitLabApiError` directly — not `handleApiError`.

- [ ] **Step 1: Replace `postJSON` error handling and catch block with `GitLabApiError` + `instanceof`**

In `src/lib/hooks/useStreamingAudit.ts`:

Add import:
```ts
import { GitLabApiError } from "@/lib/gitlab/errors";
```

Replace the `postJSON` function (lines 28–46). The key change: throw `GitLabApiError` instead of a plain `Error` with `(err as any).retryAfter`:

```ts
async function postJSON<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new GitLabApiError(
      response.status,
      data.error ?? "Unknown error",
      data.retryAfter
    );
  }

  return data as T;
}
```

Replace the catch block in `trigger` (lines 158–165). Use `instanceof GitLabApiError` directly:

```ts
    } catch (err: unknown) {
      if (err instanceof GitLabApiError && err.retryAfter) {
        setProgressWithRef({ current: progressRef.current?.current ?? 0, total: progressRef.current?.total ?? 0, phase: "rate-limited", rateLimitRemaining: rateLimitRef.current?.remaining });
        await new Promise((resolve) => setTimeout(resolve, err.retryAfter * 1000));
      }
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setProgressWithRef(null);
    }
```

- [ ] **Step 2: Run hook tests**

Run: `npx vitest run src/lib/hooks/__tests__/useStreamingAudit.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/useStreamingAudit.ts
git commit -m "refactor: replace as-any retryAfter in useStreamingAudit with GitLabApiError instanceof check"
```

---

### Task 5: Remove dead exports and consolidate duplicate types

**Files:**
- Modify: `src/lib/gitlab/aggregate.ts`
- Modify: `src/lib/gitlab/members.ts`
- Modify: `src/lib/gitlab/groups.ts`
- Modify: `src/lib/gitlab/projects.ts`
- Modify: `src/components/UserCard.tsx`

- [ ] **Step 1: Update `aggregate.ts` — remove `UserAccess`, return `UserData[]`, remove `GitLabMember` import**

```ts
import { accessLevelToString, ACCESS_LEVEL_RANK } from "./access-levels";
import type { UserData } from "@/types/audit";

interface MemberResult {
  id: number;
  fullPath: string;
  members: { id: number; username: string; name: string; accessLevel: number }[];
}

function dedupeByFullPath(
  items: { fullPath: string; accessLevel: string }[]
): { fullPath: string; accessLevel: string }[] {
  const best = new Map<string, string>();
  for (const item of items) {
    const prev = best.get(item.fullPath);
    const prevRank = prev ? (ACCESS_LEVEL_RANK[prev] ?? 0) : 0;
    const curRank = ACCESS_LEVEL_RANK[item.accessLevel] ?? 0;
    if (curRank > prevRank) best.set(item.fullPath, item.accessLevel);
  }
  return Array.from(best.entries()).map(([fullPath, accessLevel]) => ({
    fullPath,
    accessLevel,
  }));
}

export function aggregateUsers(
  groupMembers: MemberResult[],
  projectMembers: MemberResult[]
): UserData[] {
  const userMap = new Map<number, UserData>();

  function ensureUser(id: number, name: string, username: string): UserData {
    if (!userMap.has(id)) {
      userMap.set(id, { id, name, username, groups: [], projects: [] });
    }
    return userMap.get(id)!;
  }

  for (const group of groupMembers) {
    for (const member of group.members) {
      const user = ensureUser(member.id, member.name, member.username);
      user.groups.push({
        fullPath: group.fullPath,
        accessLevel: accessLevelToString(member.accessLevel),
      });
    }
  }

  for (const project of projectMembers) {
    for (const member of project.members) {
      const user = ensureUser(member.id, member.name, member.username);
      user.projects.push({
        fullPath: project.fullPath,
        accessLevel: accessLevelToString(member.accessLevel),
      });
    }
  }

  for (const user of userMap.values()) {
    user.groups = dedupeByFullPath(user.groups);
    user.projects = dedupeByFullPath(user.projects);
  }

  return Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 2: Update `members.ts` — remove `GitLabMember` and `MembersBatchResult` interfaces, import canonical `MembersBatchResult` from `@/types/audit`**

```ts
import { createGitLabClient } from "./client";
import type { RateLimitSnapshot, MembersBatchResult } from "@/types/audit";

export interface MemberResource {
  type: "group" | "project";
  id: number;
  fullPath: string;
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

Note: Both `GitLabMember` and the local `MembersBatchResult` are removed. The function returns the canonical `MembersBatchResult` from `@/types/audit`.

- [ ] **Step 3: Update `groups.ts` — remove `export` from `GitLabGroup`**

Change line 4 from:
```ts
export interface GitLabGroup {
```
to:
```ts
interface GitLabGroup {
```

- [ ] **Step 4: Update `projects.ts` — remove `export` from `GitLabProject`**

Change line 4 from:
```ts
export interface GitLabProject {
```
to:
```ts
interface GitLabProject {
```

- [ ] **Step 5: Update `UserCard.tsx` — remove `export` from `UserCardProps`**

Change line 4 from:
```ts
export type UserCardProps = UserData & { partial?: boolean };
```
to:
```ts
type UserCardProps = UserData & { partial?: boolean };
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/lib/gitlab/aggregate.ts src/lib/gitlab/members.ts src/lib/gitlab/groups.ts src/lib/gitlab/projects.ts src/components/UserCard.tsx
git commit -m "refactor: remove dead exports, consolidate duplicate types, remove GitLabMember"
```

---

### Task 6: Remove dead CSS

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Remove `--animate-shimmer` from `@theme` block**

In `src/app/globals.css`, remove line 28:
```css
  --animate-shimmer: shimmer 1.5s ease-in-out infinite;
```

- [ ] **Step 2: Remove `@keyframes shimmer` block**

Remove lines 91–94:
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

- [ ] **Step 3: Run build to verify no breakage**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "fix: remove unused shimmer animation CSS"
```

---

### Task 7: Replace module-level mutable with React ref

**Files:**
- Modify: `src/lib/hooks/useStreamingAudit.ts`
- Modify: `src/lib/hooks/__tests__/useStreamingAudit.test.ts`

- [ ] **Step 1: Update `useStreamingAudit.ts`**

Key changes from grill decisions:
- `initialDelay` is only on `trigger` args, NOT on the hook constructor
- `computeDelay` is a pure function with `(rateLimit, baseDelay)` explicit args
- `setInterBatchDelay` is removed entirely; `baseDelayRef` inside the hook holds the value
- Catch block uses `instanceof GitLabApiError` (already done in Task 4, included here for completeness)

```ts
"use client";

import { useState, useRef, useCallback } from "react";
import type { AuditResult, AuditProgress, DiscoverResult, MembersBatchResult, RateLimitSnapshot } from "@/types/audit";
import { aggregateUsers } from "@/lib/gitlab/aggregate";
import { GitLabApiError } from "@/lib/gitlab/errors";

interface AuditArgs {
  groupId: string;
  token?: string;
  initialDelay?: number;
}

const BATCH_SIZE = 5;
const RATE_LIMIT_THRESHOLD = 30;

export function computeDelay(rateLimit: RateLimitSnapshot | undefined, baseDelay: number): number {
  if (!rateLimit || rateLimit.remaining >= RATE_LIMIT_THRESHOLD) {
    return baseDelay;
  }
  const secondsUntilReset = Math.max(0, rateLimit.resetAt - Math.floor(Date.now() / 1000) + 1);
  return Math.max(baseDelay, secondsUntilReset * 1000);
}

async function postJSON<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new GitLabApiError(
      response.status,
      data.error ?? "Unknown error",
      data.retryAfter
    );
  }

  return data as T;
}

export function useStreamingAudit() {
  const [data, setData] = useState<AuditResult | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const abortRef = useRef(false);
  const rateLimitRef = useRef<RateLimitSnapshot | undefined>(undefined);
  const progressRef = useRef<AuditProgress | null>(null);
  const baseDelayRef = useRef(2000);

  const setProgressWithRef = useCallback((p: AuditProgress | null) => {
    progressRef.current = p;
    setProgress(p);
  }, []);

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
    setProgressWithRef(null);
    abortRef.current = false;
    rateLimitRef.current = undefined;
    progressRef.current = null;
  }, [setProgressWithRef]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const trigger = useCallback(async (args: AuditArgs) => {
    baseDelayRef.current = args.initialDelay ?? 2000;
    abortRef.current = false;
    setData(undefined);
    setError(undefined);
    setIsLoading(true);
    setProgressWithRef(null);

    try {
      const token = args.token || undefined;

      setProgressWithRef({ current: 0, total: 0, phase: "discovering" });
      const discoverResult = await postJSON<DiscoverResult>("/api/audit/discover", {
        groupId: args.groupId,
        token,
      });

      if (discoverResult.rateLimit) {
        rateLimitRef.current = discoverResult.rateLimit;
      }

      if (abortRef.current) {
        setIsLoading(false);
        setProgressWithRef(null);
        return;
      }

      const allResources = [
        ...discoverResult.groups.map((g) => ({ type: "group" as const, id: g.id, fullPath: g.fullPath })),
        ...discoverResult.projects.map((p) => ({ type: "project" as const, id: p.id, fullPath: p.fullPath })),
      ];

      const total = allResources.length;
      const allGroupMembers: { id: number; fullPath: string; members: MembersBatchResult["results"][number]["members"] }[] = [];
      const allProjectMembers: { id: number; fullPath: string; members: MembersBatchResult["results"][number]["members"] }[] = [];

      for (let i = 0; i < total; i += BATCH_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 0));

        if (abortRef.current) {
          setIsLoading(false);
          setProgressWithRef(null);
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
            allGroupMembers.push({ id: result.id, fullPath: result.fullPath, members: result.members });
          } else {
            allProjectMembers.push({ id: result.id, fullPath: result.fullPath, members: result.members });
          }
        });

        const users = aggregateUsers(allGroupMembers, allProjectMembers);
        setData({ users, totalUsers: users.length });

        const completedCount = Math.min(i + BATCH_SIZE, total);
        setProgressWithRef({ current: completedCount, total, phase: "fetching-members", rateLimitRemaining: rateLimitRef.current?.remaining });

        if (i + BATCH_SIZE < total) {
          const delay = computeDelay(rateLimitRef.current, baseDelayRef.current);
          if (delay > baseDelayRef.current) {
            setProgressWithRef({ current: completedCount, total, phase: "rate-limited", rateLimitRemaining: rateLimitRef.current?.remaining });
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      setProgressWithRef(null);
    } catch (err: unknown) {
      if (err instanceof GitLabApiError && err.retryAfter) {
        setProgressWithRef({ current: progressRef.current?.current ?? 0, total: progressRef.current?.total ?? 0, phase: "rate-limited", rateLimitRemaining: rateLimitRef.current?.remaining });
        await new Promise((resolve) => setTimeout(resolve, err.retryAfter * 1000));
      }
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setProgressWithRef(null);
    } finally {
      setIsLoading(false);
    }
  }, [setProgressWithRef]);

  return { trigger, abort, data, error, isLoading, progress, reset };
}
```

- [ ] **Step 2: Update `useStreamingAudit.test.ts` — replace `setInterBatchDelay` with `initialDelay`, fix `computeDelay` calls**

Replace imports on line 3:
```ts
import { useStreamingAudit, setInterBatchDelay, computeDelay } from "../useStreamingAudit";
```
with:
```ts
import { useStreamingAudit, computeDelay } from "../useStreamingAudit";
```

Remove all `setInterBatchDelay` calls:
- In `beforeEach` (line 15), remove `setInterBatchDelay(0);`
- In `afterEach` (line 21), remove `setInterBatchDelay(2000);`

Update all `renderHook(() => useStreamingAudit())` calls to pass `initialDelay` via `trigger` instead. The hook constructor takes no args now. Change the renderHook calls back to `renderHook(() => useStreamingAudit())`.

For tests that need zero delay (most of them), pass `initialDelay: 0` on the `trigger` call instead:

```ts
await act(async () => {
  result.current.trigger({ groupId: "1", initialDelay: 0 });
});
```

Apply this pattern to every `result.current.trigger(...)` call in the test file.

In the "waits for rate limit reset when remaining is low" test, remove `setInterBatchDelay(2000)` and update `computeDelay` calls to pass the base delay as a second arg:

```ts
  it("waits for rate limit reset when remaining is low", async () => {
    const now = Math.floor(Date.now() / 1000);
    const resetAt = now + 5;
    const rateLimit: RateLimitSnapshot = { limit: 500, remaining: 10, resetAt };

    const delay = computeDelay(rateLimit, 2000);
    expect(delay).toBeGreaterThan(2000);

    const highRemaining: RateLimitSnapshot = { limit: 500, remaining: 50, resetAt };
    expect(computeDelay(highRemaining, 2000)).toBe(2000);

    expect(computeDelay(undefined, 2000)).toBe(2000);
  });
```

- [ ] **Step 3: Run hook tests**

Run: `npx vitest run src/lib/hooks/__tests__/useStreamingAudit.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/hooks/useStreamingAudit.ts src/lib/hooks/__tests__/useStreamingAudit.test.ts
git commit -m "refactor: replace module-level mutable with React ref, initialDelay only on trigger"
```

---

### Task 8: Fix all remaining lint issues in test files

**Files:**
- Modify: `src/app/api/audit/members/__tests__/route.test.ts`
- Modify: `src/lib/gitlab/__tests__/members-batch.test.ts`
- Modify: `src/lib/hooks/__tests__/useStreamingAudit.test.ts`

- [ ] **Step 1: Fix `members/__tests__/route.test.ts` — 3 `as any` casts**

Add import at top:
```ts
import type { MembersBatchResult } from "@/types/audit";
```

Replace line 31:
```ts
vi.mocked(fetchMembersBatch).mockResolvedValue(batchResult as any);
```
with:
```ts
vi.mocked(fetchMembersBatch).mockResolvedValue(batchResult as MembersBatchResult);
```

Replace line 43:
```ts
vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [] } as any);
```
with:
```ts
vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [] } as MembersBatchResult);
```

Replace line 102:
```ts
vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [], rateLimit } as any);
```
with:
```ts
vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [], rateLimit } as MembersBatchResult);
```

- [ ] **Step 2: Fix `members-batch.test.ts` — 4 `as any` casts**

Replace all `mockClient as any` with `mockClient as unknown as ReturnType<typeof createGitLabClient>`:

Line 24:
```ts
vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);
```

Line 50:
```ts
vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);
```

Line 68:
```ts
vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);
```

Line 92:
```ts
vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);
```

- [ ] **Step 3: Fix `useStreamingAudit.test.ts` — remaining `as any` casts and `any` parameters**

Add import at top:
```ts
import type { UserData } from "@/types/audit";
```

Replace the `as any` cast on the `aggregatedUsers` mock (around line 30):
```ts
vi.mocked(aggregateUsers).mockReturnValue(aggregatedUsers as any);
```
with:
```ts
vi.mocked(aggregateUsers).mockReturnValue(aggregatedUsers as UserData[]);
```

For the `aggregateUsers` mock implementation (around lines 181–183), replace:
```ts
vi.mocked(aggregateUsers).mockImplementation((gm: any) => {
  const users = gm.flatMap((g: any) => g.members.map((m: any) => ({ id: m.id, name: m.name, username: m.username, groups: [], projects: [] })));
  return users;
});
```
with:
```ts
vi.mocked(aggregateUsers).mockImplementation((gm: { members: { id: number; name: string; username: string }[] }[]) => {
  const users = gm.flatMap((g) => g.members.map((m) => ({ id: m.id, name: m.name, username: m.username, groups: [], projects: [] })));
  return users as UserData[];
});
```

For the `setTimeout` mock (appears in two tests), replace:
```ts
vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: any[]) => any, ms?: number) => {
  if (typeof ms === "number") {
    setTimeoutCalls.push(ms);
  }
  return origSetTimeout(fn, 0);
}) as any);
```
with:
```ts
vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: unknown[]) => void, ms?: number) => {
  if (typeof ms === "number") {
    setTimeoutCalls.push(ms);
  }
  return origSetTimeout(fn, 0);
}) as unknown as typeof globalThis.setTimeout);
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app/api/audit/members/__tests__/route.test.ts src/lib/gitlab/__tests__/members-batch.test.ts src/lib/hooks/__tests__/useStreamingAudit.test.ts
git commit -m "fix: replace all as-any casts in test files with proper types"
```

---

### Task 9: Fix exhaustive-deps warnings

**Files:**
- Modify: `src/lib/hooks/useStreamingAudit.ts`

This was already addressed in Task 7 when we rewrote the hook — the `reset` callback includes `setProgressWithRef` in its dependency array, and `trigger` includes `setProgressWithRef`.

- [ ] **Step 1: Run lint to verify no warnings remain**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

- [ ] **Step 2: If any warnings remain, fix them inline and commit**

---

### Task 10: Final verification

**Files:** None

- [ ] **Step 1: Run full lint check**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Run production build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit if any final fixes were needed**

```bash
git add -A
git commit -m "fix: final cleanup verification adjustments"
```