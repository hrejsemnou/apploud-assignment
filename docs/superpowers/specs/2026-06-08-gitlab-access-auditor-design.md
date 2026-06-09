# GitLab Access Auditor — Design Document

**Date:** 2026-06-08
**Status:** Approved (post-grill revision)

## 1. Overview

A single-page Next.js/React tool that takes a GitLab top-level group ID and produces a human-readable list of all users who have effective access to that group, its subgroups, and its projects, including their access levels.

## 2. Architecture

### 2.1 Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Main page (form + results)
│   ├── globals.css             # Global styles
│   └── api/
│       └── audit/
│           └── route.ts        # POST /api/audit endpoint
├── lib/
│   └── gitlab/
│       ├── client.ts           # Base API client (fetch + auth + pagination + fetchOne)
│       ├── groups.ts           # Fetch top-level group + all descendant groups
│       ├── projects.ts         # Fetch projects in hierarchy
│       ├── members.ts          # Fetch effective members for groups & projects
│       ├── aggregate.ts        # Merge per-resource memberships into per-user view
│       └── access-levels.ts    # Map access_level int -> role name
└── components/
    ├── AuditForm.tsx           # Group ID + token input form
    ├── UserCard.tsx            # Single user card
    ├── UserList.tsx            # Map of UserCards + pagination + total count
    └── LoadingIndicator.tsx    # Spinner during fetch
```

### 2.2 Design Principles

- **Server-only GitLab calls**: All GitLab API requests happen in `lib/gitlab/` (imported only by the API route). The token never reaches the client.
- **Single API endpoint**: One `POST /api/audit` call handles the full audit. The server fetches everything, aggregates, and returns complete JSON.
- **Effective membership view**: Using `/members/all` (not `/members`) to show each user's effective (highest) access level per group/project, including inherited access from ancestor groups. This gives auditors the complete picture of who can access what.
- **Base URL convention**: `GITLAB_BASE_URL` is `https://gitlab.com/api/v4` (includes the API prefix). All endpoint paths are relative to this base (e.g., `/groups/42`, not `/api/v4/groups/42`).

## 3. Data Flow

### 3.1 Fetch Pipeline

```
POST /api/audit  { groupId: string, token?: string }
|
|- 1. GET /groups/:groupId (single object, via fetchOne)
|     -> Top-level group details
|
|- 2. GET /groups/:groupId/descendant_groups (paginated, per_page=100)
|     -> All subgroups in a flat list
|
|- 3. GET /groups/:groupId/projects?include_subgroups=true (paginated, per_page=100)
|     -> All projects across entire hierarchy
|
|- 4. For each group:  GET /groups/:groupId/members/all (effective, paginated)
|     Parallel batches of 15 concurrent requests
|
|- 5. For each project: GET /projects/:projectId/members/all (effective, paginated)
|     Parallel batches of 15 concurrent requests
|
|- 6. Aggregate: flip (resource -> members) into (user -> resources)
|     Map<userId, { name, username, groups: [...], projects: [...] }>
|
|- 7. Return { users: [...], totalUsers: N }
```

### 3.2 Client Methods

The API client exposes two methods:

- **`fetchOne<T>(endpoint)`**: For single-object endpoints like `GET /groups/:id`. Returns a parsed object directly. No pagination.
- **`fetchAllPages<T>(endpoint)`**: For paginated list endpoints. Handles pagination via `X-Next-Page` header automatically. Returns accumulated array.

### 3.3 Aggregation Algorithm

For each `(group_or_project, member)` pair from steps 4-5:

1. Look up the user by `member.id` in the aggregation map
2. If not present, create entry: `{ id, name, username, groups: [], projects: [] }`
3. Append membership to the appropriate array: `{ fullPath, accessLevel }`
4. `fullPath` comes from the group/project metadata (steps 1-3), not from the member response
5. `accessLevel` is the human-readable string mapped from the integer value

### 3.4 Access Level Mapping

| Integer | String            |
|---------|-------------------|
| 5       | Minimal Access    |
| 10      | Guest             |
| 15      | Planner          |
| 20      | Reporter          |
| 25      | Security Manager  |
| 30      | Developer         |
| 40      | Maintainer        |
| 50      | Owner             |

### 3.5 Pagination

All paginated GitLab endpoints use offset pagination (`?page=N&per_page=100`). The `fetchAllPages` helper:

1. Starts with `page=1`, `per_page=100`
2. Checks `X-Next-Page` response header after each request
3. If present and non-empty, increments `page` and fetches again
4. Accumulates results into a single array

### 3.6 Concurrency

Member-fetch calls (steps 4-5) are executed in parallel batches of 15 concurrent requests, using a single client instance per batch function. This balances speed against GitLab rate limits (~2000 req/min for authenticated users on GitLab.com).

## 4. Token Handling

### 4.1 Dual-Path Resolution

```
User submits form
|- Token field empty -> use process.env.GITLAB_TOKEN from .env.local
|- Token field filled -> use the provided token (sent in POST body)
|- Neither exists -> return 400 { error: "No access token provided" }
```

### 4.2 Details

- **`.env.local`**: Contains `GITLAB_TOKEN=<your-token>`. Already gitignored by Next.js defaults. Easy swap: edit file, restart dev server.
- **Form field**: `type="password"` with show/hide toggle. Placeholder: "Using token from .env.local" when empty.
- **Transport**: Token sent in POST request body, never in URL params. No localStorage, no cookies.
- **Server side**: `const gitlabToken = body.token || process.env.GITLAB_TOKEN`. Used only in `PRIVATE-TOKEN` header for GitLab API calls. Never returned to client.

## 5. UI Design

### 5.1 Page State Machine

| State     | UI                                                    |
|-----------|-------------------------------------------------------|
| Idle      | Form visible, no results shown                         |
| Loading   | Form disabled, spinner with "Fetching members from GitLab..." |
| Results   | User cards + pagination + total count                  |
| Error     | Alert banner above form with error message             |

### 5.2 AuditForm Component

- **Group ID input** (required, numeric) — pre-filled with `10975505` for dev convenience
- **Access Token input** (optional, password type with reveal toggle) — placeholder shows "Using token from .env.local" when empty
- **Submit button** — disabled while loading
- **Error banner** — shows API error messages (404, 401, etc.)

### 5.3 UserCard Component

```
+--------------------------------------------+
|  Jan Konas                                 |
|  @jan.konas                                |
|                                            |
|  Groups:                                   |
|    * apploud-external/testovaci-zadani     |
|      [Owner]                               |
|                                            |
|  Projects:                                 |
|    (none)                                  |
+--------------------------------------------+
```

- Name as bold card title
- Username as monospace/muted subtitle
- "Groups" section: bullet list with full path + access level badge
- "Projects" section: bullet list with full path + access level badge
- Empty sections show "(none)" in muted text

### 5.4 UserList Component

- Renders `UserCard` for each user on the current page, keyed by `id` (not `username`)
- **Client-side pagination**: 20 users per page (configurable: 20/50/100)
- Page controls: Previous/Next buttons + "Page X of Y" indicator
- Summary bar always visible: "Total Users: N"

### 5.5 LoadingIndicator Component

- Simple spinner animation
- Text: "Fetching members from GitLab..."

## 6. Error Handling

| GitLab Response          | Client Result                                                        |
|--------------------------|----------------------------------------------------------------------|
| 404 on group fetch       | `{ error: "Group not found. Verify the group ID." }` (404)          |
| 401 on any request       | `{ error: "Authentication failed. Check your access token." }` (401)|
| 429 (rate limit)         | Retry with exponential backoff (max 3 retries, base 1s)             |
| Network error            | Retry once, then `{ error: "Failed to reach GitLab API." }` (502)   |
| No token available       | `{ error: "No access token provided." }` (400)                      |
| Empty result set         | Success with empty `users` array; UI shows "No members found"       |

## 7. Scalability

| Scenario                              | API Calls | Estimated Time             |
|---------------------------------------|-----------|----------------------------|
| Test env (5 groups, 4 projects)       | ~10       | < 2s                       |
| Real env (30 groups, 500 projects)    | ~530      | 5-15s with parallel batching|

## 8. Grill Findings (Resolved)

| # | Issue | Resolution |
|---|---|---|
| 1 | Double `/api/v4` prefix in URL construction | Base URL includes `/api/v4`; endpoints are relative to it |
| 2 | `fetchAllPages` used for single-object endpoint (`GET /groups/:id`) | Added `fetchOne<T>` method to client |
| 3 | New client instance per item in `members.ts` batching | Create single client instance per batch function |
| 4 | Mock header inaccuracy (empty string vs absent) | Fix mocks to use `new Headers()` for single-page responses |
| 5 | Direct vs inherited members | Use `/members/all` for effective (including inherited) access per resource |
| 6 | React key using `username` | Use `id` as key |
| 7 | `create-next-app` in non-empty directory | Scaffold in temp dir, move files |
| 8 | Vitest not installed or configured | Add Vitest as dev dependency with config |
| 9 | Timer mocking with `stubGlobal` | Use `vi.useFakeTimers()` instead |
| 10 | Group validation | Rely on 404 propagation from GitLab |