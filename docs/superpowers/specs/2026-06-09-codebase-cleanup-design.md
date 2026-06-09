# Codebase Cleanup Design

## Overview

Remove dead code, consolidate duplicate types, refactor duplicated error handling into a shared utility, fix all 23 lint issues, and eliminate a module-level mutable variable. Independent of the existing cleanup-and-polish spec.

## 1. Dead Code Removal

### Unused exported types

| Type | File | Action |
|------|------|--------|
| `UserAccess` | `src/lib/gitlab/aggregate.ts` | Remove. `aggregateUsers()` returns `UserData[]` from `@/types/audit` instead. |
| `MembersBatchResult` | `src/lib/gitlab/members.ts` | Remove. Import canonical `MembersBatchResult` from `@/types/audit`. |
| `GitLabGroup` | `src/lib/gitlab/groups.ts` | Remove `export` keyword. Type stays, just not exported. |
| `GitLabProject` | `src/lib/gitlab/projects.ts` | Remove `export` keyword. Type stays, just not exported. |
| `UserCardProps` | `src/components/UserCard.tsx` | Remove `export` keyword. Type stays, just not exported. |

### Dead CSS

| Symbol | File | Action |
|--------|------|--------|
| `--animate-shimmer` | `src/app/globals.css` (line ~28) | Remove from `@theme` block |
| `@keyframes shimmer` | `src/app/globals.css` (line ~91) | Remove entire keyframe block |

### Dead class export

| Symbol | File | Action |
|--------|------|--------|
| `GitLabApiError` | `src/lib/gitlab/client.ts` | Remove export. Class moves to `errors.ts` (Section 3). |

## 2. Duplicate Type Consolidation

### `UserData` vs `UserAccess`

Remove `UserAccess` from `aggregate.ts`. Update `aggregateUsers()` return type to `UserData[]` (imported from `@/types/audit`). No consumer currently imports `UserAccess`; the hook already uses `UserData` via `AuditResult`.

### Dual `MembersBatchResult`

Remove definition from `members.ts`. Import canonical `MembersBatchResult` from `@/types/audit` instead. Update `fetchMembersBatch` return type. The canonical type in `audit.ts` uses an inline member type `{ id: number; username: string; name: string; accessLevel: number }[]`; keep this and adjust `fetchMembersBatch` to return it.

## 3. Error Handling Refactor

### New file: `src/lib/gitlab/errors.ts`

```ts
export class GitLabApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "GitLabApiError";
    this.status = status;
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

### Client.ts changes

- `GitLabApiError` class definition removed (moved to `errors.ts`)
- `client.ts` imports `GitLabApiError` from `./errors` and throws it in the same places

### Hook changes (`useStreamingAudit.ts`)

- Import `handleApiError` from `@/lib/gitlab/errors`
- Replace `(err as any).retryAfter` with `handleApiError(err).retryAfter` (3 occurrences)
- Replace duck-typing in catch blocks with `handleApiError(err)`

### Route changes

- `discover/route.ts` and `members/route.ts`: import `handleApiError` from `@/lib/gitlab/errors`
- Replace 6-line catch blocks with:
  ```ts
  const { status, message } = handleApiError(err);
  return NextResponse.json({ error: message }, { status });
  ```

### Test updates

- `client.test.ts`: update import path from `@/lib/gitlab/client` to `@/lib/gitlab/errors` for `GitLabApiError`

## 4. Lint Fixes

### 21 `no-explicit-any` errors

3 in `useStreamingAudit.ts` resolved by Section 3 (`handleApiError`).

18 in test files — replace `as any` casts with proper types:

- **route.test.ts** (3 errors): Type mock `fetch` return values as `Partial<Response>` or use explicit mock typing
- **client.test.ts** (1 error): Replace `(caught as any).retryAfter` with `handleApiError(caught).retryAfter`
- **members-batch.test.ts** (4 errors): Type mock parameters with actual function signatures instead of `as any`
- **useStreamingAudit.test.ts** (10 errors): Replace `(gm: any)` / `(g: any)` / `(m: any)` with proper types (`GitLabMember`, `string`, etc.), replace `(...args: any[])` with specific parameter types matching the mocked function signatures

### 2 `exhaustive-deps` warnings

In `useStreamingAudit.ts`, add `setProgressWithRef` to the dependency arrays of both `reset` (line ~70) and `trigger` (line ~169) callbacks. `setProgressWithRef` is already a stable `useCallback`, so this won't cause re-renders.

## 5. Module-Level Mutable Variable

Replace `let interBatchDelayMs = 2000` and exported `setInterBatchDelay()` with a ref inside the hook:

- Add `initialDelay?: number` to the hook's options parameter (currently `UseStreamingAuditOptions`)
- `const interBatchDelayRef = useRef(options.initialDelay ?? 2000)` — holds current delay
- All reads change from `interBatchDelayMs` to `interBatchDelayRef.current`
- Remove `setInterBatchDelay` export entirely
- Tests pass `{ initialDelay: 0 }` instead of calling `setInterBatchDelay(0)`
- Remove all `setInterBatchDelay` calls from test files