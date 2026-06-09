# Streaming Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `/api/audit` endpoint with three stateless endpoints and a client-side orchestration loop that works within Vercel hobby's 10s function timeout.

**Architecture:** Client calls `/api/audit/discover` (get groups+projects), then loops `/api/audit/members` in batches of 15, then calls `/api/audit/aggregate`. Each call completes in < 5s. Progress is shown in the UI.

**Tech Stack:** Next.js API routes, React hooks (useState/useRef/useCallback), Vitest for testing.

---

## File Structure

**Create:**
- `src/app/api/audit/discover/route.ts`
- `src/app/api/audit/discover/__tests__/route.test.ts`
- `src/app/api/audit/members/route.ts`
- `src/app/api/audit/members/__tests__/route.test.ts`
- `src/app/api/audit/aggregate/route.ts`
- `src/app/api/audit/aggregate/__tests__/route.test.ts`
- `src/lib/hooks/useStreamingAudit.ts`
- `src/lib/hooks/__tests__/useStreamingAudit.test.ts`

**Modify:**
- `src/types/audit.ts` — add `DiscoverResult`, `MembersBatchResult`, `AuditProgress`
- `src/lib/gitlab/members.ts` — add `fetchMembersBatch` + `MemberResource` type
- `src/components/LoadingIndicator.tsx` — add `progress` prop
- `src/components/AuditForm.tsx` — add `onAbort` prop
- `src/app/page.tsx` — swap `useAudit` for `useStreamingAudit`

**Delete:**
- `src/app/api/audit/route.ts`
- `src/app/api/audit/__tests__/route.test.ts`
- `src/lib/hooks/useAudit.ts`
- `src/lib/hooks/__tests__/useAudit.test.ts`

---

### Task 1: Add streaming audit types

**Files:**
- Modify: `src/types/audit.ts`

- [ ] **Step 1: Add new types to audit.ts**

Append after the existing `AuditResult` interface:

```ts
export interface DiscoverResult {
  groups: { id: number; fullPath: string; name: string }[];
  projects: { id: number; fullPath: string; name: string }[];
}

export interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: { id: number; username: string; name: string; accessLevel: number }[];
  }>;
}

export interface AuditProgress {
  current: number;
  total: number;
  phase: "discovering" | "fetching-members" | "aggregating";
}
```

The full file should look like:

```ts
export interface UserData {
  id: number;
  name: string;
  username: string;
  groups: { fullPath: string; accessLevel: string }[];
  projects: { fullPath: string; accessLevel: string }[];
}

export interface AuditResult {
  users: UserData[];
  totalUsers: number;
}

export interface DiscoverResult {
  groups: { id: number; fullPath: string; name: string }[];
  projects: { id: number; fullPath: string; name: string }[];
}

export interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: { id: number; username: string; name: string; accessLevel: number }[];
  }>;
}

export interface AuditProgress {
  current: number;
  total: number;
  phase: "discovering" | "fetching-members" | "aggregating";
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/types/audit.ts
git commit -m "feat: add streaming audit types"
```

---

### Task 2: Add `fetchMembersBatch` to members module

This is the server-side function that the `/api/audit/members` route will call. It accepts a generic array of resources (each tagged as "group" or "project") and fetches their members using the existing client.

**Files:**
- Modify: `src/lib/gitlab/members.ts`
- Create: `src/lib/gitlab/__tests__/members-batch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/gitlab/__tests__/members-batch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMembersBatch } from "../members";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
  RateLimiter: class RateLimiter {
    async acquire() {}
  },
}));

import { createGitLabClient } from "../client";

describe("fetchMembersBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches members for a batch of group resources", async () => {
    const mockClient = {
      fetchAllPages: vi.fn().mockResolvedValue([
        { id: 1, username: "alice", name: "Alice", access_level: 30 },
      ]),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as any);

    const result = await fetchMembersBatch(
      [{ type: "group" as const, id: 42, fullPath: "my-group" }],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe(42);
    expect(result.results[0].fullPath).toBe("my-group");
    expect(result.results[0].members).toEqual([
      { id: 1, username: "alice", name: "Alice", accessLevel: 30 },
    ]);
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith("/groups/42/members/all");
  });

  it("fetches members for project resources using projects endpoint", async () => {
    const mockClient = {
      fetchAllPages: vi.fn().mockResolvedValue([
        { id: 2, username: "bob", name: "Bob", access_level: 40 },
      ]),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as any);

    const result = await fetchMembersBatch(
      [{ type: "project" as const, id: 99, fullPath: "my-group/my-project" }],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(mockClient.fetchAllPages).toHaveBeenCalledWith("/projects/99/members/all");
    expect(result.results[0].members[0].accessLevel).toBe(40);
  });

  it("handles mixed group and project resources", async () => {
    const mockClient = {
      fetchAllPages: vi.fn()
        .mockResolvedValueOnce([{ id: 1, username: "alice", name: "Alice", access_level: 30 }])
        .mockResolvedValueOnce([{ id: 2, username: "bob", name: "Bob", access_level: 40 }]),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as any);

    const result = await fetchMembersBatch(
      [
        { type: "group" as const, id: 10, fullPath: "group-a" },
        { type: "project" as const, id: 20, fullPath: "group-a/proj-b" },
      ],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(result.results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gitlab/__tests__/members-batch.test.ts`
Expected: FAIL — `fetchMembersBatch` is not exported from `../members`

- [ ] **Step 3: Add `fetchMembersBatch` and `MemberResource` to members.ts**

Add the following to `src/lib/gitlab/members.ts` after the existing `ProjectMembersResult` interface:

```ts
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
}

export async function fetchMembersBatch(
  resources: MemberResource[],
  baseUrl: string,
  token: string,
  rateLimiter?: RateLimiter
): Promise<MembersBatchResult> {
  const client = createGitLabClient(baseUrl, token, rateLimiter);

  const results = await Promise.all(
    resources.map(async (resource) => {
      const endpoint = resource.type === "group"
        ? `/groups/${resource.id}/members/all`
        : `/projects/${resource.id}/members/all`;

      const raw = await client.fetchAllPages<{
        id: number;
        username: string;
        name: string;
        access_level: number;
      }>(endpoint);

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

  return { results };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gitlab/__tests__/members-batch.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing members tests to verify nothing broke**

Run: `npx vitest run src/lib/gitlab/__tests__/members.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/gitlab/members.ts src/lib/gitlab/__tests__/members-batch.test.ts
git commit -m "feat: add fetchMembersBatch for streaming audit"
```

---

### Task 3: Create `/api/audit/discover` endpoint

**Files:**
- Create: `src/app/api/audit/discover/route.ts`
- Create: `src/app/api/audit/discover/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/audit/discover/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

vi.mock("@/lib/gitlab/groups", () => ({
  fetchGroupHierarchy: vi.fn(),
}));

vi.mock("@/lib/gitlab/projects", () => ({
  fetchProjectsInHierarchy: vi.fn(),
}));

vi.mock("@/lib/gitlab/client", () => ({
  RateLimiter: class RateLimiter {
    async acquire() {}
  },
}));

import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/audit/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/audit/discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = "env-token";
  });

  it("returns groups and projects", async () => {
    const groups = [{ id: 1, fullPath: "g", name: "G" }];
    const projects = [{ id: 10, fullPath: "g/p", name: "P" }];

    vi.mocked(fetchGroupHierarchy).mockResolvedValue(groups);
    vi.mocked(fetchProjectsInHierarchy).mockResolvedValue(projects);

    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.groups).toEqual(groups);
    expect(data.projects).toEqual(projects);
  });

  it("returns 400 when groupId is missing", async () => {
    const response = await POST(createRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Group ID is required");
  });

  it("returns 400 when no token is provided", async () => {
    delete process.env.GITLAB_TOKEN;
    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("No access token provided");
  });

  it("passes through GitLab API errors with status", async () => {
    const err = new Error("401 Unauthorized");
    Object.assign(err, { status: 401 });
    vi.mocked(fetchGroupHierarchy).mockRejectedValue(err);

    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("401 Unauthorized");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/audit/discover/__tests__/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the discover route**

Create `src/app/api/audit/discover/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";
import { RateLimiter } from "@/lib/gitlab/client";

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

  const rateLimiter = new RateLimiter();

  try {
    const [groups, projects] = await Promise.all([
      fetchGroupHierarchy(groupId, GITLAB_BASE_URL, gitlabToken, rateLimiter),
      fetchProjectsInHierarchy(groupId, GITLAB_BASE_URL, gitlabToken, rateLimiter),
    ]);

    return NextResponse.json({ groups, projects });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
    const message = err instanceof Error ? err.message : "Failed to reach GitLab API";

    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/audit/discover/__tests__/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/audit/discover/
git commit -m "feat: add /api/audit/discover endpoint"
```

---

### Task 4: Create `/api/audit/members` endpoint

**Files:**
- Create: `src/app/api/audit/members/route.ts`
- Create: `src/app/api/audit/members/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/audit/members/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

vi.mock("@/lib/gitlab/members", () => ({
  fetchMembersBatch: vi.fn(),
}));

vi.mock("@/lib/gitlab/client", () => ({
  RateLimiter: class RateLimiter {
    async acquire() {}
  },
}));

import { fetchMembersBatch } from "@/lib/gitlab/members";

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/audit/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/audit/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = "env-token";
  });

  it("returns members for a batch of resources", async () => {
    const batchResult = {
      results: [
        { id: 42, fullPath: "my-group", members: [{ id: 1, username: "alice", name: "Alice", accessLevel: 30 }] },
      ],
    };
    vi.mocked(fetchMembersBatch).mockResolvedValue(batchResult as any);

    const response = await POST(createRequest({
      resources: [{ type: "group", id: 42, fullPath: "my-group" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results).toEqual(batchResult.results);
  });

  it("passes token from request body", async () => {
    vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [] } as any);

    await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
      token: "custom-token",
    }));

    expect(fetchMembersBatch).toHaveBeenCalledWith(
      [{ type: "group", id: 1, fullPath: "g" }],
      "https://gitlab.com/api/v4",
      "custom-token",
      expect.anything()
    );
  });

  it("returns 400 when resources array is missing", async () => {
    const response = await POST(createRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Resources array is required");
  });

  it("returns 400 when no token is available", async () => {
    delete process.env.GITLAB_TOKEN;
    const response = await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("No access token provided");
  });

  it("passes through GitLab API errors with status", async () => {
    const err = new Error("429 Too Many Requests");
    Object.assign(err, { status: 429 });
    vi.mocked(fetchMembersBatch).mockRejectedValue(err);

    const response = await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toBe("429 Too Many Requests");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/audit/members/__tests__/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the members route**

Create `src/app/api/audit/members/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchMembersBatch, MemberResource } from "@/lib/gitlab/members";
import { RateLimiter } from "@/lib/gitlab/client";

const GITLAB_BASE_URL = "https://gitlab.com/api/v4";

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

  const gitlabToken = token || process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    return NextResponse.json({ error: "No access token provided" }, { status: 400 });
  }

  const rateLimiter = new RateLimiter();

  try {
    const result = await fetchMembersBatch(resources, GITLAB_BASE_URL, gitlabToken, rateLimiter);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
    const message = err instanceof Error ? err.message : "Failed to reach GitLab API";

    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/audit/members/__tests__/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/audit/members/
git commit -m "feat: add /api/audit/members endpoint"
```

---

### Task 5: Create `/api/audit/aggregate` endpoint

**Files:**
- Create: `src/app/api/audit/aggregate/route.ts`
- Create: `src/app/api/audit/aggregate/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/audit/aggregate/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

vi.mock("@/lib/gitlab/aggregate", () => ({
  aggregateUsers: vi.fn(),
}));

import { aggregateUsers } from "@/lib/gitlab/aggregate";

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/audit/aggregate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/audit/aggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregated users", async () => {
    const users = [{ id: 1, name: "Alice", username: "alice", groups: [], projects: [] }];
    vi.mocked(aggregateUsers).mockReturnValue(users as any);

    const response = await POST(createRequest({
      groupMembers: [],
      projectMembers: [],
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.users).toEqual(users);
    expect(data.totalUsers).toBe(1);
  });

  it("passes groupMembers and projectMembers to aggregateUsers", async () => {
    const gm = [{ groupId: 1, groupFullPath: "g", members: [] }];
    const pm = [{ projectId: 10, projectFullPath: "g/p", members: [] }];
    vi.mocked(aggregateUsers).mockReturnValue([]);

    await POST(createRequest({ groupMembers: gm, projectMembers: pm }));

    expect(aggregateUsers).toHaveBeenCalledWith(gm, pm);
  });

  it("returns 400 when groupMembers is missing", async () => {
    const response = await POST(createRequest({
      projectMembers: [],
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("groupMembers and projectMembers arrays are required");
  });

  it("returns 400 when projectMembers is missing", async () => {
    const response = await POST(createRequest({
      groupMembers: [],
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("groupMembers and projectMembers arrays are required");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/audit/aggregate/__tests__/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the aggregate route**

Create `src/app/api/audit/aggregate/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { aggregateUsers } from "@/lib/gitlab/aggregate";
import type { GroupMembersResult, ProjectMembersResult } from "@/lib/gitlab/members";

export async function POST(request: NextRequest) {
  let body: { groupMembers?: GroupMembersResult[]; projectMembers?: ProjectMembersResult[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { groupMembers, projectMembers } = body;

  if (!Array.isArray(groupMembers) || !Array.isArray(projectMembers)) {
    return NextResponse.json(
      { error: "groupMembers and projectMembers arrays are required" },
      { status: 400 }
    );
  }

  const users = aggregateUsers(groupMembers, projectMembers);

  return NextResponse.json({ users, totalUsers: users.length });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/audit/aggregate/__tests__/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/audit/aggregate/
git commit -m "feat: add /api/audit/aggregate endpoint"
```

---

### Task 6: Create `useStreamingAudit` hook

**Files:**
- Create: `src/lib/hooks/useStreamingAudit.ts`
- Create: `src/lib/hooks/__tests__/useStreamingAudit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/hooks/__tests__/useStreamingAudit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStreamingAudit } from "../useStreamingAudit";

const BATCH_SIZE = 15;

describe("useStreamingAudit", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("orchestrates discover → members → aggregate flow", async () => {
    const groups = [{ id: 1, fullPath: "g", name: "G" }];
    const projects = [{ id: 10, fullPath: "g/p", name: "P" }];
    const members = [{ id: 1, username: "alice", name: "Alice", accessLevel: 30 }];

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [{ id: 1, fullPath: "g", members }] }) } as Response;
      }
      if (url.includes("/api/audit/aggregate")) {
        return {
          ok: true, status: 200,
          json: () => Promise.resolve({ users: [{ id: 1, name: "Alice", username: "alice", groups: [{ fullPath: "g", accessLevel: "Developer" }], projects: [] }], totalUsers: 1 }),
        } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.totalUsers).toBe(1);
    expect(result.current.error).toBeUndefined();
  });

  it("stops on error from discover", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: false, status: 401, json: () => Promise.resolve({ error: "401 Unauthorized" }) } as Response;
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.error).toBeDefined());

    expect(result.current.error?.message).toBe("401 Unauthorized");
    expect(result.current.data).toBeUndefined();
  });

  it("sends multiple member batches for large resource sets", async () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, fullPath: `g${i}`, name: `G${i}` }));
    let membersCallCount = 0;

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [] }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        membersCallCount++;
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [] }) } as Response;
      }
      if (url.includes("/api/audit/aggregate")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ users: [], totalUsers: 0 }) } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    // 20 groups / 15 per batch = 2 batches
    expect(membersCallCount).toBe(2);
  });

  it("resets state", async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      return { ok: true, status: 200, json: () => Promise.resolve({ groups: [], projects: [] }) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.progress).toBeNull();
  });

  it("aborts after current batch", async () => {
    const groups = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, fullPath: `g${i}`, name: `G${i}` }));
    let membersCallCount = 0;

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [] }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        membersCallCount++;
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [] }) } as Response;
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    // Abort after first batch completes (15 resources)
    act(() => {
      result.current.abort();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should have made the discover call + first batch only (not the second batch of 15)
    expect(membersCallCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hooks/__tests__/useStreamingAudit.test.ts`
Expected: FAIL — `useStreamingAudit` is not defined

- [ ] **Step 3: Create the hook**

Create `src/lib/hooks/useStreamingAudit.ts`:

```ts
"use client";

import { useState, useRef, useCallback } from "react";
import type { AuditResult, AuditProgress, DiscoverResult, MembersBatchResult } from "@/types/audit";

interface AuditArgs {
  groupId: string;
  token?: string;
}

const BATCH_SIZE = 15;

async function postJSON<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Unknown error");
  }

  return data as T;
}

export function useStreamingAudit() {
  const [data, setData] = useState<AuditResult | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
    setProgress(null);
    abortRef.current = false;
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

    try {
      const token = args.token || undefined;

      // Phase 1: Discover
      setProgress({ current: 0, total: 0, phase: "discovering" });
      const discoverResult = await postJSON<DiscoverResult>("/api/audit/discover", {
        groupId: args.groupId,
        token,
      });

      if (abortRef.current) {
        setIsLoading(false);
        setProgress(null);
        return;
      }

      // Phase 2: Fetch members in batches
      const allResources = [
        ...discoverResult.groups.map((g) => ({ type: "group" as const, id: g.id, fullPath: g.fullPath })),
        ...discoverResult.projects.map((p) => ({ type: "project" as const, id: p.id, fullPath: p.fullPath })),
      ];

      const total = allResources.length;
      const allGroupMembers: Array<{ groupId: number; groupFullPath: string; members: Array<{ id: number; username: string; name: string; accessLevel: number }> }> = [];
      const allProjectMembers: Array<{ projectId: number; projectFullPath: string; members: Array<{ id: number; username: string; name: string; accessLevel: number }> }> = [];

      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (abortRef.current) {
          setIsLoading(false);
          setProgress(null);
          return;
        }

        const batch = allResources.slice(i, i + BATCH_SIZE);
        setProgress({ current: i, total, phase: "fetching-members" });

        const batchResult = await postJSON<MembersBatchResult>("/api/audit/members", {
          resources: batch,
          token,
        });

        // Distribute results into groupMembers and projectMembers
        // Use index-based matching since a group and project could share the same id
        batch.forEach((resource, idx) => {
          const result = batchResult.results[idx];
          if (!result) return;

          if (resource.type === "group") {
            allGroupMembers.push({ groupId: result.id, groupFullPath: result.fullPath, members: result.members });
          } else {
            allProjectMembers.push({ projectId: result.id, projectFullPath: result.fullPath, members: result.members });
          }
        });
      }

      if (abortRef.current) {
        setIsLoading(false);
        setProgress(null);
        return;
      }

      // Phase 3: Aggregate
      setProgress({ current: total, total, phase: "aggregating" });
      const aggregateResult = await postJSON<AuditResult>("/api/audit/aggregate", {
        groupMembers: allGroupMembers,
        projectMembers: allProjectMembers,
      });

      setData(aggregateResult);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { trigger, abort, data, error, isLoading, progress, reset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hooks/__tests__/useStreamingAudit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks/useStreamingAudit.ts src/lib/hooks/__tests__/useStreamingAudit.test.ts
git commit -m "feat: add useStreamingAudit hook with progress and abort"
```

---

### Task 7: Update UI components

**Files:**
- Modify: `src/components/LoadingIndicator.tsx`
- Modify: `src/components/AuditForm.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update LoadingIndicator to accept progress prop**

Replace `src/components/LoadingIndicator.tsx` with:

```tsx
import type { AuditProgress } from "@/types/audit";

interface LoadingIndicatorProps {
  progress?: AuditProgress | null;
}

export function LoadingIndicator({ progress }: LoadingIndicatorProps) {
  const statusText = progress?.phase === "fetching-members"
    ? `Fetching members... ${progress.current} / ${progress.total}`
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
        {progress?.phase === "fetching-members" && (
          <div className="mt-2 w-48 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update AuditForm to support abort**

In `src/components/AuditForm.tsx`, change the `AuditFormProps` interface to:

```ts
interface AuditFormProps {
  onSubmit: (groupId: string, token: string) => void;
  isLoading: boolean;
  onAbort?: () => void;
}
```

Update the component signature to:

```ts
export function AuditForm({ onSubmit, isLoading, onAbort }: AuditFormProps) {
```

Replace the submit button section with:

```tsx
          <button
            type={isLoading && onAbort ? "button" : "submit"}
            disabled={false}
            onClick={isLoading && onAbort ? onAbort : undefined}
            className="w-full sm:w-auto rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:shadow-md active:scale-[0.98]"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Cancel
              </span>
            ) : (
              "Run Audit"
            )}
          </button>
```

- [ ] **Step 3: Update page.tsx to use useStreamingAudit**

Replace `src/app/page.tsx` with:

```tsx
"use client";

import { AuditForm } from "@/components/AuditForm";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { UserList } from "@/components/UserList";
import { useStreamingAudit } from "@/lib/hooks/useStreamingAudit";

export default function Home() {
  const { trigger, abort, data, error, isLoading, progress, reset } = useStreamingAudit();

  function handleAudit(groupId: string, token: string) {
    trigger({ groupId, token: token || undefined });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-surface-elevated">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" />
            <span className="font-display text-xs tracking-wider uppercase text-muted">
              Access Audit Tool
            </span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-medium tracking-tight text-foreground">
            GitLab Access Auditor
          </h1>
          <p className="mt-2 text-sm text-muted leading-relaxed max-w-lg">
            Inspect who has access to what across your GitLab groups and projects. Enter a group ID to start.
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-danger/30 bg-danger-soft p-4 animate-slide-down">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-danger">Audit failed</p>
                <p className="mt-1 text-sm text-danger/80">{error.message}</p>
              </div>
              <button
                onClick={reset}
                className="text-xs text-danger/60 hover:text-danger underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <AuditForm
          onSubmit={handleAudit}
          isLoading={isLoading}
          onAbort={abort}
        />

        {isLoading ? <LoadingIndicator progress={progress} /> : null}

        {data ? (
          <div className="animate-fade-in">
            <UserList users={data.users} totalUsers={data.totalUsers} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/LoadingIndicator.tsx src/components/AuditForm.tsx src/app/page.tsx
git commit -m "feat: update UI for streaming audit with progress and abort"
```

---

### Task 8: Remove old endpoint and hook

**Files:**
- Delete: `src/app/api/audit/route.ts`
- Delete: `src/app/api/audit/__tests__/route.test.ts`
- Delete: `src/lib/hooks/useAudit.ts`
- Delete: `src/lib/hooks/__tests__/useAudit.test.ts`

- [ ] **Step 1: Delete old files**

```bash
rm src/app/api/audit/route.ts
rm -rf src/app/api/audit/__tests__
rm src/lib/hooks/useAudit.ts
rm src/lib/hooks/__tests__/useAudit.test.ts
```

- [ ] **Step 2: Verify all tests still pass**

Run: `npx vitest run`
Expected: All tests pass (old test files gone, new test files present)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old monolithic audit endpoint and useAudit hook"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit any remaining fixes if needed**