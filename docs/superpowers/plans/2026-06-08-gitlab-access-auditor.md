# GitLab Access Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page Next.js/React tool that takes a GitLab top-level group ID and lists all users with effective access to that group, its subgroups, and its projects, including their access levels.

**Architecture:** Server-side data fetching via a single `POST /api/audit` REST endpoint. The server walks the GitLab group hierarchy, fetches effective members (including inherited) of each group and project using `/members/all`, aggregates by user, and returns JSON. The client renders user cards with client-side pagination. Token is resolved from `.env.local` or an optional form field. Base URL is `https://gitlab.com/api/v4` — endpoint paths are relative to it (no `/api/v4` prefix in endpoint strings).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Vitest

---

## File Structure

### Server-side GitLab data layer (`src/lib/gitlab/`)

| File | Responsibility |
|------|---------------|
| `src/lib/gitlab/client.ts` | Base HTTP client: authenticated fetch, `fetchOne` for single objects, `fetchAllPages` for paginated lists, retry with backoff |
| `src/lib/gitlab/access-levels.ts` | Access level integer → human-readable string mapping |
| `src/lib/gitlab/groups.ts` | Fetch top-level group (via `fetchOne`) + all descendant groups (via `fetchAllPages`) |
| `src/lib/gitlab/projects.ts` | Fetch all projects in group hierarchy (with `include_subgroups`) |
| `src/lib/gitlab/members.ts` | Fetch effective members (`/members/all`) for groups and projects (parallel batched, single client instance) |
| `src/lib/gitlab/aggregate.ts` | Merge per-resource memberships into per-user view |

### API route

| File | Responsibility |
|------|---------------|
| `src/app/api/audit/route.ts` | POST handler: resolve token, orchestrate fetch pipeline, return JSON |

### Client-side components

| File | Responsibility |
|------|---------------|
| `src/app/layout.tsx` | Root layout with HTML metadata |
| `src/app/page.tsx` | Main page: form state, loading state, results state, error state |
| `src/app/globals.css` | Tailwind directives + custom styles |
| `src/components/AuditForm.tsx` | Group ID + optional token form |
| `src/components/LoadingIndicator.tsx` | Spinner + message |
| `src/components/UserCard.tsx` | Single user's name, username, groups, projects |
| `src/components/UserList.tsx` | UserCard grid + client-side pagination + total count |

### Config and environment

| File | Responsibility |
|------|---------------|
| `.env.local` | `GITLAB_TOKEN` value (gitignored) |
| `.env.example` | Template showing required env vars |

---

## Task 1: Scaffold Next.js Project

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Modify: `.gitignore`

- [ ] **Step 1: Create Next.js project in temp directory**

Run:
```bash
TMPDIR=$(mktemp -d) && npx create-next-app@latest "$TMPDIR/app" --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm && cp -r "$TMPDIR/app/." . && rm -rf "$TMPDIR"
```

This scaffolds in a temp dir then copies files into the project root, avoiding conflicts with existing files.

- [ ] **Step 2: Install Vitest**

Run:
```bash
npm install -D vitest @vitejs/plugin-react jsdom
```

Write `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Verify dev server starts**

Run:
```bash
npm run dev
```

Expected: Server starts on `http://localhost:3000`, page renders "Next.js" default content.

- [ ] **Step 4: Stop dev server, verify .gitignore has .env.local**

Read `.gitignore` and verify it contains `.env.local`. Next.js scaffolding includes this by default.

- [ ] **Step 5: Create .env.local and .env.example**

Write `.env.local`:
```
GITLAB_TOKEN=your-gitlab-access-token-here
```

Write `.env.example`:
```
GITLAB_TOKEN=your-gitlab-access-token-here
```

- [ ] **Step 6: Replace default page content with empty shell**

Write `src/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">GitLab Access Auditor</h1>
      <p className="text-gray-500">Enter a group ID to audit access.</p>
    </main>
  );
}
```

Write `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitLab Access Auditor",
  description: "Audit user access across GitLab groups and projects",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Verify page renders**

Run:
```bash
npm run dev
```

Open `http://localhost:3000`, verify "GitLab Access Auditor" heading and placeholder text render. Stop server.

- [ ] **Step 8: Commit scaffold**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Tailwind CSS"
```

---

## Task 2: Access Level Mapping

**Files:**
- Create: `src/lib/gitlab/access-levels.ts`
- Create: `src/lib/gitlab/__tests__/access-levels.test.ts`

- [ ] **Step 1: Write failing test for access level mapping**

Write `src/lib/gitlab/__tests__/access-levels.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { accessLevelToString } from "../access-levels";

describe("accessLevelToString", () => {
  it("maps 50 to Owner", () => {
    expect(accessLevelToString(50)).toBe("Owner");
  });

  it("maps 30 to Developer", () => {
    expect(accessLevelToString(30)).toBe("Developer");
  });

  it("maps 10 to Guest", () => {
    expect(accessLevelToString(10)).toBe("Guest");
  });

  it("maps 40 to Maintainer", () => {
    expect(accessLevelToString(40)).toBe("Maintainer");
  });

  it("maps 20 to Reporter", () => {
    expect(accessLevelToString(20)).toBe("Reporter");
  });

  it("maps 5 to Minimal Access", () => {
    expect(accessLevelToString(5)).toBe("Minimal Access");
  });

  it("maps 15 to Planner", () => {
    expect(accessLevelToString(15)).toBe("Planner");
  });

  it("maps 25 to Security Manager", () => {
    expect(accessLevelToString(25)).toBe("Security Manager");
  });

  it("returns Unknown for unrecognized level", () => {
    expect(accessLevelToString(99)).toBe("Unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/access-levels.test.ts
```

Expected: FAIL — module `../access-levels` not found.

- [ ] **Step 3: Implement access-levels.ts**

Write `src/lib/gitlab/access-levels.ts`:
```ts
const ACCESS_LEVELS: Record<number, string> = {
  5: "Minimal Access",
  10: "Guest",
  15: "Planner",
  20: "Reporter",
  25: "Security Manager",
  30: "Developer",
  40: "Maintainer",
  50: "Owner",
};

export function accessLevelToString(level: number): string {
  return ACCESS_LEVELS[level] ?? "Unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/access-levels.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/access-levels.ts src/lib/gitlab/__tests__/access-levels.test.ts
git commit -m "feat: add access level integer-to-string mapping"
```

---

## Task 3: Base GitLab API Client

**Files:**
- Create: `src/lib/gitlab/client.ts`
- Create: `src/lib/gitlab/__tests__/client.test.ts`

- [ ] **Step 1: Write failing tests for the client**

Write `src/lib/gitlab/__tests__/client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGitLabClient } from "../client";

describe("createGitLabClient", () => {
  const baseUrl = "https://gitlab.example.com/api/v4";
  const token = "test-token";
  let client: ReturnType<typeof createGitLabClient>;

  beforeEach(() => {
    client = createGitLabClient(baseUrl, token);
  });

  it("fetches a single page of results", async () => {
    const data = [{ id: 1 }, { id: 2 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          headers: new Headers(),
        } as Response)
      )
    );

    const result = await client.fetchAllPages<{ id: number }>("/groups");
    expect(result).toEqual(data);
  });

  it("paginates through multiple pages", async () => {
    const page1 = [{ id: 1 }];
    const page2 = [{ id: 2 }];
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        const headers = new Headers();
        if (callCount === 1) headers.set("x-next-page", "2");
        const data = callCount === 1 ? page1 : page2;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          headers,
        } as Response);
      })
    );

    const result = await client.fetchAllPages<{ id: number }>("/groups");
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(callCount).toBe(2);
  });

  it("fetchOne returns a single object", async () => {
    const group = { id: 1, name: "Top Group" };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(group),
          headers: new Headers(),
        } as Response)
      )
    );

    const result = await client.fetchOne<{ id: number; name: string }>("/groups/1");
    expect(result).toEqual({ id: 1, name: "Top Group" });
  });

  it("fetchOne constructs correct URL", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1 }),
        headers: new Headers(),
      } as Response)
    );
    vi.stubGlobal("fetch", fetchSpy);

    await client.fetchOne("/groups/42");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/groups/42",
      expect.objectContaining({
        headers: expect.objectContaining({ "PRIVATE-TOKEN": token }),
      })
    );
  });

  it("throws on 401 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: "401 Unauthorized" }),
          headers: new Headers(),
        } as Response)
      )
    );

    await expect(
      client.fetchAllPages("/groups")
    ).rejects.toThrow("Authentication failed");
  });

  it("throws on 404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ message: "404 Not Found" }),
          headers: new Headers(),
        } as Response)
      )
    );

    await expect(
      client.fetchAllPages("/groups/999")
    ).rejects.toThrow("Not found");
  });

  describe("429 retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on 429 and succeeds on second attempt", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: () => Promise.resolve({ message: "rate limited" }),
              headers: new Headers(),
            } as Response);
          }
          const headers = new Headers();
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: 1 }]),
            headers,
          } as Response);
        })
      );

      const promise = client.fetchAllPages<{ id: number }>("/groups");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result).toEqual([{ id: 1 }]);
      expect(callCount).toBe(2);
    });
  });

  it("sends PRIVATE-TOKEN header", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      } as Response)
    );
    vi.stubGlobal("fetch", fetchSpy);

    await client.fetchAllPages("/groups");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "PRIVATE-TOKEN": token }),
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/client.test.ts
```

Expected: FAIL — module `../client` not found.

- [ ] **Step 3: Implement client.ts**

Write `src/lib/gitlab/client.ts`:
```ts
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const PER_PAGE = 100;

class GitLabApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGitLabClient(baseUrl: string, token: string) {
  async function fetchWithRetry(
    url: string,
    retriesLeft: number = MAX_RETRIES
  ): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) return response;

    if (response.status === 401) {
      throw new GitLabApiError(401, "Authentication failed. Check your access token.");
    }

    if (response.status === 404) {
      throw new GitLabApiError(404, "Not found. Verify the group ID or resource exists.");
    }

    if (response.status === 429 && retriesLeft > 0) {
      await sleep(RETRY_BASE_MS * (MAX_RETRIES - retriesLeft + 1));
      return fetchWithRetry(url, retriesLeft - 1);
    }

    const body = await response.json().catch(() => ({}));
    throw new GitLabApiError(
      response.status,
      body.message ?? `GitLab API error: ${response.status}`
    );
  }

  async function fetchOne<T>(endpoint: string): Promise<T> {
    const url = `${baseUrl}${endpoint}`;
    const response = await fetchWithRetry(url);
    return response.json();
  }

  async function fetchAllPages<T>(endpoint: string): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const separator = endpoint.includes("?") ? "&" : "?";
      const url = `${baseUrl}${endpoint}${separator}per_page=${PER_PAGE}&page=${page}`;
      const response = await fetchWithRetry(url);
      const data: T[] = await response.json();
      results.push(...data);

      const nextPage = response.headers.get("x-next-page");
      hasMore = nextPage !== null && nextPage !== "";
      if (hasMore) page = Number(nextPage);
    }

    return results;
  }

  return { fetchOne, fetchAllPages };
}

export { GitLabApiError };
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/client.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/client.ts src/lib/gitlab/__tests__/client.test.ts
git commit -m "feat: add GitLab API client with pagination and retry logic"
```

---

## Task 4: Fetch Groups

**Files:**
- Create: `src/lib/gitlab/groups.ts`
- Create: `src/lib/gitlab/__tests__/groups.test.ts`

- [ ] **Step 1: Write failing tests for group fetching**

Write `src/lib/gitlab/__tests__/groups.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGroupHierarchy } from "../groups";
import { createGitLabClient } from "../client";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

describe("fetchGroupHierarchy", () => {
  let mockFetchOne: ReturnType<typeof createGitLabClient>["fetchOne"];
  let mockFetchAllPages: ReturnType<typeof createGitLabClient>["fetchAllPages"];

  beforeEach(() => {
    mockFetchOne = vi.fn();
    mockFetchAllPages = vi.fn();
    (createGitLabClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchOne: mockFetchOne,
      fetchAllPages: mockFetchAllPages,
    });
  });

  it("fetches top-level group and descendant groups", async () => {
    const topGroup = { id: 1, full_path: "top-group", name: "Top Group" };
    const descendants = [
      { id: 2, full_path: "top-group/sub1", name: "Sub 1" },
      { id: 3, full_path: "top-group/sub2", name: "Sub 2" },
    ];

    mockFetchOne.mockResolvedValue(topGroup);
    mockFetchAllPages.mockResolvedValue(descendants);

    const result = await fetchGroupHierarchy("1", "https://gitlab.com/api/v4", "token");

    expect(result).toEqual([
      { id: 1, fullPath: "top-group", name: "Top Group" },
      { id: 2, fullPath: "top-group/sub1", name: "Sub 1" },
      { id: 3, fullPath: "top-group/sub2", name: "Sub 2" },
    ]);
  });

  it("includes only top-level group when no descendants", async () => {
    const topGroup = { id: 1, full_path: "top-group", name: "Top Group" };

    mockFetchOne.mockResolvedValue(topGroup);
    mockFetchAllPages.mockResolvedValue([]);

    const result = await fetchGroupHierarchy("1", "https://gitlab.com/api/v4", "token");

    expect(result).toEqual([{ id: 1, fullPath: "top-group", name: "Top Group" }]);
  });

  it("calls correct API endpoints", async () => {
    mockFetchOne.mockResolvedValue({ id: 1, full_path: "g", name: "G" });
    mockFetchAllPages.mockResolvedValue([]);

    await fetchGroupHierarchy("42", "https://gitlab.com/api/v4", "token");

    expect(mockFetchOne).toHaveBeenCalledWith("/groups/42");
    expect(mockFetchAllPages).toHaveBeenCalledWith("/groups/42/descendant_groups");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/groups.test.ts
```

Expected: FAIL — module `../groups` not found.

- [ ] **Step 3: Implement groups.ts**

Write `src/lib/gitlab/groups.ts`:
```ts
import { createGitLabClient } from "./client";

export interface GitLabGroup {
  id: number;
  fullPath: string;
  name: string;
}

export async function fetchGroupHierarchy(
  groupId: string,
  baseUrl: string,
  token: string
): Promise<GitLabGroup[]> {
  const client = createGitLabClient(baseUrl, token);

  const topGroup = await client.fetchOne<{
    id: number;
    full_path: string;
    name: string;
  }>(`/groups/${groupId}`);

  const descendantsRaw = await client.fetchAllPages<{
    id: number;
    full_path: string;
    name: string;
  }>(`/groups/${groupId}/descendant_groups`);

  const normalize = (g: { id: number; full_path: string; name: string }): GitLabGroup => ({
    id: g.id,
    fullPath: g.full_path,
    name: g.name,
  });

  return [normalize(topGroup), ...descendantsRaw.map(normalize)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/groups.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/groups.ts src/lib/gitlab/__tests__/groups.test.ts
git commit -m "feat: add group hierarchy fetching (top-level + descendants)"
```

---

## Task 5: Fetch Projects

**Files:**
- Create: `src/lib/gitlab/projects.ts`
- Create: `src/lib/gitlab/__tests__/projects.test.ts`

- [ ] **Step 1: Write failing tests for project fetching**

Write `src/lib/gitlab/__tests__/projects.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchProjectsInHierarchy } from "../projects";
import { createGitLabClient } from "../client";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

describe("fetchProjectsInHierarchy", () => {
  let mockFetchAllPages: ReturnType<typeof createGitLabClient>["fetchAllPages"];

  beforeEach(() => {
    mockFetchAllPages = vi.fn();
    (createGitLabClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchAllPages: mockFetchAllPages,
    });
  });

  it("fetches all projects in group hierarchy", async () => {
    const projects = [
      { id: 10, path_with_namespace: "top-group/project-1", name: "Project 1" },
      { id: 11, path_with_namespace: "top-group/sub1/project-2", name: "Project 2" },
    ];

    mockFetchAllPages.mockResolvedValueOnce(projects);

    const result = await fetchProjectsInHierarchy("1", "https://gitlab.com", "token");

    expect(result).toEqual([
      { id: 10, fullPath: "top-group/project-1", name: "Project 1" },
      { id: 11, fullPath: "top-group/sub1/project-2", name: "Project 2" },
    ]);
  });

  it("returns empty array when no projects", async () => {
    mockFetchAllPages.mockResolvedValueOnce([]);

    const result = await fetchProjectsInHierarchy("1", "https://gitlab.com", "token");

    expect(result).toEqual([]);
  });

  it("calls correct API endpoint with include_subgroups", async () => {
    mockFetchAllPages.mockResolvedValueOnce([]);

    await fetchProjectsInHierarchy("42", "https://gitlab.com/api/v4", "token");

    expect(mockFetchAllPages).toHaveBeenCalledWith(
      "/groups/42/projects?include_subgroups=true&simple=true"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/projects.test.ts
```

Expected: FAIL — module `../projects` not found.

- [ ] **Step 3: Implement projects.ts**

Write `src/lib/gitlab/projects.ts`:
```ts
import { createGitLabClient } from "./client";

export interface GitLabProject {
  id: number;
  fullPath: string;
  name: string;
}

export async function fetchProjectsInHierarchy(
  groupId: string,
  baseUrl: string,
  token: string
): Promise<GitLabProject[]> {
  const client = createGitLabClient(baseUrl, token);

  const raw = await client.fetchAllPages<{
    id: number;
    path_with_namespace: string;
    name: string;
  }>(`/groups/${groupId}/projects?include_subgroups=true&simple=true`);

  return raw.map((p) => ({
    id: p.id,
    fullPath: p.path_with_namespace,
    name: p.name,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/projects.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/projects.ts src/lib/gitlab/__tests__/projects.test.ts
git commit -m "feat: add project fetching with include_subgroups"
```

---

## Task 6: Fetch Members (Batched Parallel)

**Files:**
- Create: `src/lib/gitlab/members.ts`
- Create: `src/lib/gitlab/__tests__/members.test.ts`

- [ ] **Step 1: Write failing tests for member fetching**

Write `src/lib/gitlab/__tests__/members.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGroupMembers, fetchProjectMembers } from "../members";
import { createGitLabClient } from "../client";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

describe("fetchGroupMembers", () => {
  let mockFetchAllPages: ReturnType<typeof createGitLabClient>["fetchAllPages"];

  beforeEach(() => {
    mockFetchAllPages = vi.fn();
    (createGitLabClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchAllPages: mockFetchAllPages,
      fetchOne: vi.fn(),
    });
  });

  it("fetches effective members for each group", async () => {
    const groups = [
      { id: 1, fullPath: "top-group", name: "Top Group" },
      { id: 2, fullPath: "top-group/sub1", name: "Sub 1" },
    ];

    mockFetchAllPages
      .mockResolvedValueOnce([
        { id: 10, username: "user1", name: "User One", access_level: 50 },
      ])
      .mockResolvedValueOnce([
        { id: 20, username: "user2", name: "User Two", access_level: 10 },
      ]);

    const result = await fetchGroupMembers(groups, "https://gitlab.com/api/v4", "token");

    expect(result).toEqual([
      {
        groupId: 1,
        groupFullPath: "top-group",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 50 },
        ],
      },
      {
        groupId: 2,
        groupFullPath: "top-group/sub1",
        members: [
          { id: 20, username: "user2", name: "User Two", accessLevel: 10 },
        ],
      },
    ]);
  });

  it("returns empty members for groups with no members", async () => {
    mockFetchAllPages.mockResolvedValue([]);

    const groups = [{ id: 1, fullPath: "top-group", name: "Top Group" }];
    const result = await fetchGroupMembers(groups, "https://gitlab.com/api/v4", "token");

    expect(result).toEqual([
      { groupId: 1, groupFullPath: "top-group", members: [] },
    ]);
  });

  it("calls /members/all endpoint for groups", async () => {
    mockFetchAllPages.mockResolvedValue([]);

    const groups = [{ id: 42, fullPath: "g", name: "G" }];
    await fetchGroupMembers(groups, "https://gitlab.com/api/v4", "token");

    expect(mockFetchAllPages).toHaveBeenCalledWith("/groups/42/members/all");
  });
});

describe("fetchProjectMembers", () => {
  let mockFetchAllPages: ReturnType<typeof createGitLabClient>["fetchAllPages"];

  beforeEach(() => {
    mockFetchAllPages = vi.fn();
    (createGitLabClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchAllPages: mockFetchAllPages,
      fetchOne: vi.fn(),
    });
  });

  it("fetches effective members for each project", async () => {
    const projects = [
      { id: 10, fullPath: "top-group/project-1", name: "Project 1" },
    ];

    mockFetchAllPages.mockResolvedValueOnce([
      { id: 30, username: "user3", name: "User Three", access_level: 30 },
    ]);

    const result = await fetchProjectMembers(projects, "https://gitlab.com/api/v4", "token");

    expect(result).toEqual([
      {
        projectId: 10,
        projectFullPath: "top-group/project-1",
        members: [
          { id: 30, username: "user3", name: "User Three", accessLevel: 30 },
        ],
      },
    ]);
  });

  it("calls /members/all endpoint per project", async () => {
    mockFetchAllPages.mockResolvedValue([]);

    const projects = [{ id: 99, fullPath: "g/p", name: "P" }];
    await fetchProjectMembers(projects, "https://gitlab.com/api/v4", "token");

    expect(mockFetchAllPages).toHaveBeenCalledWith("/projects/99/members/all");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/members.test.ts
```

Expected: FAIL — module `../members` not found.

- [ ] **Step 3: Implement members.ts**

Write `src/lib/gitlab/members.ts`:
```ts
import { createGitLabClient } from "./client";
import type { GitLabGroup } from "./groups";
import type { GitLabProject } from "./projects";

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

async function fetchInBatches<T>(
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
        const raw = await client.fetchAllPages<{
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/members.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/members.ts src/lib/gitlab/__tests__/members.test.ts
git commit -m "feat: add batched parallel member fetching for groups and projects"
```

---

## Task 7: Aggregate by User

**Files:**
- Create: `src/lib/gitlab/aggregate.ts`
- Create: `src/lib/gitlab/__tests__/aggregate.test.ts`

- [ ] **Step 1: Write failing tests for aggregation**

Write `src/lib/gitlab/__tests__/aggregate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { aggregateUsers } from "../aggregate";
import type { GroupMembersResult, ProjectMembersResult } from "../members";

describe("aggregateUsers", () => {
  it("aggregates single group membership", () => {
    const groupMembers: GroupMembersResult[] = [
      {
        groupId: 1,
        groupFullPath: "top-group",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 50 },
        ],
      },
    ];
    const projectMembers: ProjectMembersResult[] = [];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [{ fullPath: "top-group", accessLevel: "Owner" }],
        projects: [],
      },
    ]);
  });

  it("aggregates group and project memberships for same user", () => {
    const groupMembers: GroupMembersResult[] = [
      {
        groupId: 1,
        groupFullPath: "top-group/sub1",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 10 },
        ],
      },
    ];
    const projectMembers: ProjectMembersResult[] = [
      {
        projectId: 20,
        projectFullPath: "top-group/project-1",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 30 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [{ fullPath: "top-group/sub1", accessLevel: "Guest" }],
        projects: [{ fullPath: "top-group/project-1", accessLevel: "Developer" }],
      },
    ]);
  });

  it("merges multiple group memberships for same user", () => {
    const groupMembers: GroupMembersResult[] = [
      {
        groupId: 1,
        groupFullPath: "top-group",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 50 },
        ],
      },
      {
        groupId: 2,
        groupFullPath: "top-group/sub1",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 10 },
        ],
      },
    ];
    const projectMembers: ProjectMembersResult[] = [];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [
          { fullPath: "top-group", accessLevel: "Owner" },
          { fullPath: "top-group/sub1", accessLevel: "Guest" },
        ],
        projects: [],
      },
    ]);
  });

  it("returns empty groups and projects for user with neither", () => {
    const groupMembers: GroupMembersResult[] = [];
    const projectMembers: ProjectMembersResult[] = [];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result).toEqual([]);
  });

  it("sorts users by name", () => {
    const groupMembers: GroupMembersResult[] = [
      {
        groupId: 1,
        groupFullPath: "top-group",
        members: [
          { id: 20, username: "user2", name: "Zeta User", accessLevel: 10 },
          { id: 10, username: "user1", name: "Alpha User", accessLevel: 50 },
        ],
      },
    ];
    const projectMembers: ProjectMembersResult[] = [];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result[0].name).toBe("Alpha User");
    expect(result[1].name).toBe("Zeta User");
  });

  it("handles multiple users with multiple projects", () => {
    const groupMembers: GroupMembersResult[] = [];
    const projectMembers: ProjectMembersResult[] = [
      {
        projectId: 1,
        projectFullPath: "g/p1",
        members: [
          { id: 10, username: "a", name: "Alice", accessLevel: 30 },
          { id: 20, username: "b", name: "Bob", accessLevel: 10 },
        ],
      },
      {
        projectId: 2,
        projectFullPath: "g/p2",
        members: [
          { id: 10, username: "a", name: "Alice", accessLevel: 40 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "Alice",
        username: "a",
        groups: [],
        projects: [
          { fullPath: "g/p1", accessLevel: "Developer" },
          { fullPath: "g/p2", accessLevel: "Maintainer" },
        ],
      },
      {
        id: 20,
        name: "Bob",
        username: "b",
        groups: [],
        projects: [{ fullPath: "g/p1", accessLevel: "Guest" }],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/aggregate.test.ts
```

Expected: FAIL — module `../aggregate` not found.

- [ ] **Step 3: Implement aggregate.ts**

Write `src/lib/gitlab/aggregate.ts`:
```ts
import { accessLevelToString } from "./access-levels";
import type { GroupMembersResult, ProjectMembersResult } from "./members";

export interface UserAccess {
  id: number;
  name: string;
  username: string;
  groups: { fullPath: string; accessLevel: string }[];
  projects: { fullPath: string; accessLevel: string }[];
}

export function aggregateUsers(
  groupMembers: GroupMembersResult[],
  projectMembers: ProjectMembersResult[]
): UserAccess[] {
  const userMap = new Map<number, UserAccess>();

  function ensureUser(id: number, name: string, username: string): UserAccess {
    if (!userMap.has(id)) {
      userMap.set(id, { id, name, username, groups: [], projects: [] });
    }
    return userMap.get(id)!;
  }

  for (const group of groupMembers) {
    for (const member of group.members) {
      const user = ensureUser(member.id, member.name, member.username);
      user.groups.push({
        fullPath: group.groupFullPath,
        accessLevel: accessLevelToString(member.accessLevel),
      });
    }
  }

  for (const project of projectMembers) {
    for (const member of project.members) {
      const user = ensureUser(member.id, member.name, member.username);
      user.projects.push({
        fullPath: project.projectFullPath,
        accessLevel: accessLevelToString(member.accessLevel),
      });
    }
  }

  return Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/gitlab/__tests__/aggregate.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gitlab/aggregate.ts src/lib/gitlab/__tests__/aggregate.test.ts
git commit -m "feat: add user membership aggregation logic"
```

---

## Task 8: API Route — POST /api/audit

**Files:**
- Create: `src/app/api/audit/route.ts`

- [ ] **Step 1: Implement the audit API route**

Write `src/app/api/audit/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";
import { fetchGroupMembers, fetchProjectMembers } from "@/lib/gitlab/members";
import { aggregateUsers } from "@/lib/gitlab/aggregate";
import { GitLabApiError } from "@/lib/gitlab/client";

const GITLAB_BASE_URL = "https://gitlab.com/api/v4";

export async function POST(request: NextRequest) {
  let body: { groupId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { groupId, token } = body;

  if (!groupId) {
    return NextResponse.json(
      { error: "Group ID is required" },
      { status: 400 }
    );
  }

  const gitlabToken = token || process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    return NextResponse.json(
      { error: "No access token provided" },
      { status: 400 }
    );
  }

  try {
    const groups = await fetchGroupHierarchy(groupId, GITLAB_BASE_URL, gitlabToken);
    const projects = await fetchProjectsInHierarchy(groupId, GITLAB_BASE_URL, gitlabToken);
    const groupMembers = await fetchGroupMembers(groups, GITLAB_BASE_URL, gitlabToken);
    const projectMembers = await fetchProjectMembers(projects, GITLAB_BASE_URL, gitlabToken);
    const users = aggregateUsers(groupMembers, projectMembers);

    return NextResponse.json({ users, totalUsers: users.length });
  } catch (err) {
    if (err instanceof GitLabApiError) {
      const statusMap: Record<number, number> = {
        401: 401,
        404: 404,
      };
      return NextResponse.json(
        { error: err.message },
        { status: statusMap[err.status] ?? 502 }
      );
    }

    return NextResponse.json(
      { error: "Failed to reach GitLab API" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Verify the route compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/audit/route.ts
git commit -m "feat: add POST /api/audit endpoint"
```

---

## Task 9: LoadingIndicator Component

**Files:**
- Create: `src/components/LoadingIndicator.tsx`

- [ ] **Step 1: Implement LoadingIndicator**

Write `src/components/LoadingIndicator.tsx`:
```tsx
export function LoadingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      <p className="mt-4 text-gray-500">Fetching members from GitLab...</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/LoadingIndicator.tsx
git commit -m "feat: add LoadingIndicator component"
```

---

## Task 10: UserCard Component

**Files:**
- Create: `src/components/UserCard.tsx`

- [ ] **Step 1: Implement UserCard**

Write `src/components/UserCard.tsx`:
```tsx
export interface UserCardProps {
  name: string;
  username: string;
  groups: { fullPath: string; accessLevel: string }[];
  projects: { fullPath: string; accessLevel: string }[];
}

function MembershipList({
  items,
  label,
}: {
  items: { fullPath: string; accessLevel: string }[];
  label: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-gray-500 mb-1">{label}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">(none)</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.fullPath} className="text-sm flex items-baseline gap-2">
              <span className="text-gray-700 break-all">{item.fullPath}</span>
              <span className="shrink-0 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                {item.accessLevel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UserCard({ name, username, groups, projects }: UserCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
      <p className="text-sm font-mono text-gray-500 mb-4">@{username}</p>
      <div className="space-y-3">
        <MembershipList items={groups} label="Groups" />
        <MembershipList items={projects} label="Projects" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/UserCard.tsx
git commit -m "feat: add UserCard component"
```

---

## Task 11: UserList Component (with Pagination)

**Files:**
- Create: `src/components/UserList.tsx`

- [ ] **Step 1: Implement UserList**

Write `src/components/UserList.tsx`:
```tsx
"use client";

import { useState } from "react";
import { UserCard, type UserCardProps } from "./UserCard";

const PER_PAGE_OPTIONS = [20, 50, 100];

interface UserListProps {
  users: UserCardProps[];
  totalUsers: number;
}

export function UserList({ users, totalUsers }: UserListProps) {
  const [perPage, setPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(users.length / perPage));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * perPage;
  const pageUsers = users.slice(start, start + perPage);

  if (safePage !== currentPage) {
    setCurrentPage(safePage);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">
          Total Users: <span className="font-semibold">{totalUsers}</span>
        </p>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <label htmlFor="per-page">Per page:</label>
          <select
            id="per-page"
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {PER_PAGE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {totalUsers === 0 ? (
        <p className="text-gray-500 text-center py-8">No members found in this group hierarchy.</p>
      ) : (
        <div className="space-y-4">
          {pageUsers.map((user) => (
            <UserCard
              key={user.id}
              name={user.name}
              username={user.username}
              groups={user.groups}
              projects={user.projects}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6 text-sm">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-gray-600">
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/UserList.tsx
git commit -m "feat: add UserList component with client-side pagination"
```

---

## Task 12: AuditForm Component

**Files:**
- Create: `src/components/AuditForm.tsx`

- [ ] **Step 1: Implement AuditForm**

Write `src/components/AuditForm.tsx`:
```tsx
"use client";

import { useState } from "react";

interface AuditFormProps {
  onSubmit: (groupId: string, token: string) => void;
  isLoading: boolean;
}

export function AuditForm({ onSubmit, isLoading }: AuditFormProps) {
  const [groupId, setGroupId] = useState("10975505");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(groupId, token);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mb-8">
      <div>
        <label htmlFor="group-id" className="block text-sm font-medium text-gray-700 mb-1">
          Group ID
        </label>
        <input
          id="group-id"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          required
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          disabled={isLoading}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
          placeholder="e.g. 10975505"
        />
      </div>
      <div>
        <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
          Access Token
          <span className="font-normal text-gray-400 ml-1">(optional)</span>
        </label>
        <div className="relative">
          <input
            id="token"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isLoading}
            className="w-full rounded-md border border-gray-300 px-3 py-2 pr-16 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            placeholder="Using token from .env.local"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700 px-1"
            tabIndex={-1}
          >
            {showToken ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Auditing..." : "Audit Access"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AuditForm.tsx
git commit -m "feat: add AuditForm component with token reveal toggle"
```

---

## Task 13: Main Page — Wire Everything Together

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Implement the main page with all states**

Write `src/app/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { AuditForm } from "@/components/AuditForm";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { UserList } from "@/components/UserList";
import type { UserCardProps } from "@/components/UserCard";

type PageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; users: UserCardProps[]; totalUsers: number }
  | { status: "error"; message: string };

export default function Home() {
  const [state, setState] = useState<PageState>({ status: "idle" });

  async function handleAudit(groupId: string, token: string) {
    setState({ status: "loading" });

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, token: token || undefined }),
      });

      const data = await response.json();

      if (!response.ok) {
        setState({ status: "error", message: data.error ?? "Unknown error" });
        return;
      }

      setState({
        status: "results",
        users: data.users,
        totalUsers: data.totalUsers,
      });
    } catch {
      setState({ status: "error", message: "Failed to reach the server" });
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">GitLab Access Auditor</h1>

      {state.status === "error" && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-700">{state.message}</p>
          <button
            onClick={() => setState({ status: "idle" })}
            className="mt-2 text-xs text-red-600 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <AuditForm
        onSubmit={handleAudit}
        isLoading={state.status === "loading"}
      />

      {state.status === "loading" && <LoadingIndicator />}

      {state.status === "results" && (
        <UserList users={state.users} totalUsers={state.totalUsers} />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the app compiles and runs**

Run:
```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: wire main page with form, loading, results, and error states"
```

---

## Task 14: End-to-End Manual Test

**Files:** None new

- [ ] **Step 1: Start dev server**

Run:
```bash
npm run dev
```

- [ ] **Step 2: Test with the real GitLab group**

1. Open `http://localhost:3000`
2. Verify "GitLab Access Auditor" heading renders
3. Verify Group ID is pre-filled with `10975505`
4. Verify token field shows placeholder "Using token from .env.local"
5. Click "Audit Access"
6. Verify spinner appears with "Fetching members from GitLab..."
7. Wait for results to load
8. Verify user cards appear with names, usernames, groups, and projects
9. Verify "Total Users: 5" is shown
10. Verify the users and their memberships match the spec's expected output:
    - Jan Konáš (@jan.konas) — Groups: apploud-external/testovaci-zadani (Owner), Projects: (none)
    - Jan Konáš (@jankonas1) — Groups: apploud-external/testovaci-zadani (Owner), Projects: (none)
    - Michal Pham (@KhanhPhams) — Groups: apploud-external/testovaci-zadani/skupina-3 (Guest), Projects: apploud-external/testovaci-zadani/uloha-1 (Guest)
    - Martin Špicar (@martin.spicar) — Groups: (none), Projects: 3 entries
    - Michal Bílý (@MichalBily) — Groups: apploud-external/testovaci-zadani/skupina-1 (Guest), Projects: (none)

- [ ] **Step 3: Test error state**

1. Clear the Group ID field, enter `99999999`
2. Click "Audit Access"
3. Verify error banner appears with "Not found" message
4. Click "Dismiss" — verify error disappears

- [ ] **Step 4: Test empty token error**

1. Temporarily rename `.env.local` to `.env.local.bak`
2. Restart dev server
3. Submit with empty token field
4. Verify "No access token provided" error appears
5. Restore `.env.local`, restart dev server

- [ ] **Step 5: Stop dev server and commit**

No code changes in this task — skip commit unless fixes were needed.

---

## Task 15: Run All Tests and Final Checks

**Files:** None new

- [ ] **Step 1: Run full test suite**

Run:
```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 2: Run TypeScript check**

Run:
```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Run lint**

Run:
```bash
npm run lint
```

Expected: No lint errors.

- [ ] **Step 4: Run build**

Run:
```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Final commit if any fixes were made**

If any fixes were needed during the checks above, commit them:
```bash
git add -A
git commit -m "fix: resolve issues found during final checks"
```

---

## Self-Review

### Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| Next.js + React | Task 1 (scaffold) |
| Group ID via form | Task 12 (AuditForm), Task 13 (page) |
| Token not as CLI arg, easily swappable | Task 1 (.env.local), Task 12 (optional form field), Task 8 (API route token resolution) |
| Recursive group hierarchy | Task 4 (fetchGroupHierarchy with descendant_groups) |
| Projects always in a group | Task 5 (fetchProjectsInHierarchy with include_subgroups) |
| Users as members of groups and projects | Task 6 (fetchGroupMembers, fetchProjectMembers) |
| User civic name | Task 7 (aggregateUsers includes `name`) |
| User username | Task 7 (aggregateUsers includes `username`) |
| Group list with access level (within scope) | Task 7 (aggregateUsers includes groups with accessLevel) |
| Project list with access level (within scope) | Task 7 (aggregateUsers includes projects with accessLevel) |
| Total user count | Task 11 (UserList shows totalUsers) |
| Works at scale (~500 projects, ~50 users) | Task 6 (batched parallel), Task 3 (pagination) |
| Effective members (including inherited) | Task 6 (uses `/members/all`) |
| GitLab REST API (not GraphQL) | Task 3 (client.ts), Task 8 (route.ts) |
| React keys use id | Task 11 (UserList uses `key={user.id}`) |
| Base URL includes /api/v4 | Task 3 (client), Task 8 (route), Tasks 4-6 (endpoint paths) |
| fetchOne for single-object endpoints | Task 3 (client.ts), Task 4 (groups.ts) |
| Vitest configured | Task 1 (install + vitest.config.ts) |
| vi.useFakeTimers for retry tests | Task 3 (client.test.ts) |
| Scaffold in temp dir | Task 1 |

### Placeholder Scan

No TBDs, no "TODO", no "implement later", no "add appropriate error handling". All steps contain complete code.

### Type Consistency Check

- `GitLabGroup` defined in `groups.ts` with `id`, `fullPath`, `name` — used consistently in `members.ts` and `aggregate.ts`
- `GitLabProject` defined in `projects.ts` with `id`, `fullPath`, `name` — used consistently in `members.ts`
- `GitLabMember` defined in `members.ts` with `id`, `username`, `name`, `accessLevel` — used in `GroupMembersResult` and `ProjectMembersResult`
- `UserAccess` defined in `aggregate.ts` — matches `UserCardProps` in `UserCard.tsx` (shape: `{ name, username, groups: [{ fullPath, accessLevel }], projects: [{ fullPath, accessLevel }] }`)
- `accessLevelToString` returns `string` — consistent with `accessLevel` field in aggregate types

All types are consistent across modules. No mismatches found.