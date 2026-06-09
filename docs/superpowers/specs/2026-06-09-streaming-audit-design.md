# Streaming Audit Architecture — Design Document

**Date:** 2026-06-09
**Status:** Approved

## 1. Problem

The current `POST /api/audit` endpoint fetches all groups, projects, and members in a single request. For large GitLab organizations (500+ projects, 30+ groups), this takes 4+ minutes due to rate limiting (200 req/min on members endpoints). On Vercel hobby tier (10s function timeout), the request fails every time for non-trivial groups. The browser shows "pending" with 0 bytes transferred until the server responds or times out.

## 2. Architecture

Replace the single monolithic endpoint with three small, stateless endpoints. The client orchestrates the flow by calling them in sequence.

### 2.1 API Surface

**`POST /api/audit/discover`**
- Input: `{ groupId: string, token?: string }`
- Fetches: top-level group + descendant groups + all projects (2-3 paginated GitLab API calls)
- Returns: `{ groups: GitLabGroup[], projects: GitLabProject[] }`
- Time: < 3s for any group size

**`POST /api/audit/members`**
- Input: `{ resources: [{ type: "group"|"project", id: number, fullPath: string }], token?: string }`
- Fetches members for each resource in the provided array (max 15 per call, matching existing `BATCH_SIZE`)
- Returns: `{ results: Array<{ id: number, fullPath: string, members: GitLabMember[] }> }`
- Time: ~4s per batch at 150 req/min rate limit

**`POST /api/audit/aggregate`**
- Input: `{ groupMembers: GroupMembersResult[], projectMembers: ProjectMembersResult[] }`
- Pure computation, no GitLab API calls
- Returns: `{ users: UserData[], totalUsers: number }` (same shape as current `AuditResult`)
- Time: < 100ms

### 2.2 Client Orchestration Flow

```
User clicks "Run Audit"
  |
  ├─ 1. POST /api/audit/discover  →  { groups, projects }
  |     Phase: "discovering"
  |
  ├─ 2. Loop: POST /api/audit/members  (batches of 15 resources)
  |     Phase: "fetching-members"
  |     Progress: current/total resources
  |     Accumulates: all groupMembers + projectMembers
  |
  └─ 3. POST /api/audit/aggregate  →  { users, totalUsers }
        Phase: "aggregating"
        Final result displayed
```

Each server call completes within the 10s Vercel limit. The client calls them sequentially — no shared state, no database, no long-lived connections.

### 2.3 Constraints Satisfied

- **Vercel hobby 10s timeout**: Each call completes in < 5s.
- **No shared state**: All data needed is in the request body.
- **No external dependencies**: No KV store, no database.
- **Rate limit safety**: 15 resources/batch × ~4s. Sequential client calls provide natural spacing.

## 3. Type Changes

```ts
// New: result from /discover
interface DiscoverResult {
  groups: GitLabGroup[];
  projects: GitLabProject[];
}

// New: result from /members (single batch)
interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: GitLabMember[];
  }>;
}

// Unchanged: /aggregate returns same AuditResult shape
```

## 4. Hook: `useStreamingAudit`

Replaces `useAudit`.

```ts
interface StreamingAuditState {
  trigger: (args: AuditArgs) => void;
  abort: () => void;
  data: AuditResult | undefined;
  error: Error | undefined;
  isLoading: boolean;
  progress: { current: number; total: number; phase: string } | null;
  reset: () => void;
}
```

### State Machine

```
idle → discovering → fetching-members → aggregating → done
  ↘       ↘               ↘                 ↘
  error   error           error             error
```

### Error Handling

Any failed API call stops the audit immediately. Error displayed in the existing error banner. No resume — user retries from scratch.

### Cancellation

`abort()` sets a flag. After the current batch completes, the loop stops. No server-side cancellation.

## 5. UI Changes

**`LoadingIndicator`**: Accept optional `progress: { current: number; total: number; phase: string }`. When present, shows "Fetching members... 124 / 530". When absent, renders existing static text.

**`AuditForm`**: Accept `onAbort` callback. When `isLoading` is true, the submit button becomes a "Cancel" button that calls `onAbort`.

**`page.tsx`**: Swap `useAudit` for `useStreamingAudit`. Pass `progress` to `LoadingIndicator`, `onAbort` to `AuditForm`.

## 6. What Gets Removed

- `POST /api/audit/route.ts` — replaced by three new endpoints
- `useAudit` hook — replaced by `useStreamingAudit`
- Related test files

## 7. What Stays the Same

- `lib/gitlab/client.ts` — `RateLimiter`, `createGitLabClient`, `GitLabApiError`
- `lib/gitlab/groups.ts` — `fetchGroupHierarchy` (used by `/discover`)
- `lib/gitlab/projects.ts` — `fetchProjectsInHierarchy` (used by `/discover`)
- `lib/gitlab/members.ts` — `fetchGroupMembers`/`fetchProjectMembers` (used by `/members`)
- `lib/gitlab/aggregate.ts` — `aggregateUsers` (used by `/aggregate`)
- `components/UserCard.tsx`, `UserList.tsx`
- `types/audit.ts` — `AuditResult`/`UserData`

## 8. Scalability

500 projects + 30 groups = 530 resources. At 15/batch = 36 batches × ~4s ≈ 2.5 min total. Each request < 5s (within Vercel 10s limit). Progress updates in real-time.