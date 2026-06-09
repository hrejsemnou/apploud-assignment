# GitLab Access Auditor

A single-page tool to audit user access across GitLab groups and projects. Enter a top-level group ID and get a complete list of all users with effective access to that group, its subgroups, and its projects — including their access levels.

Results stream in progressively as member data is fetched, with adaptive rate limiting to stay within GitLab's API limits.

## Features

- **Streaming results** — Users appear incrementally as each batch of member data is fetched
- **Adaptive rate limiting** — Monitors GitLab's rate limit headers and auto-throttles when remaining quota is low
- **Abort capability** — Cancel a running audit at any time
- **Search & filter** — Filter users by name, username, group, or project path
- **Dark mode** — Follows system preference via `prefers-color-scheme`
- **Client-side pagination** — 20/50/100 items per page, configurable
- **Collapsible memberships** — Shows 3 items by default, expand to see all

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env.local` file with your GitLab access token:

```bash
cp .env.example .env.local
# Edit .env.local and replace the placeholder with your token
```

3. Start the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Usage

1. Enter a GitLab group ID in the form (e.g. `10975505`)
2. Optionally provide an access token in the form field (overrides `.env.local`)
3. Click **Run Audit**
4. Results stream in progressively — user cards appear as each batch of member data is fetched
5. A progress indicator shows the current phase and percentage complete
6. Click **Cancel** to abort a running audit
7. Use the search field to filter results by name, username, group path, or project path
8. Adjust pagination (20/50/100 per page) as needed

## Architecture

The audit runs in two phases, orchestrated client-side by the `useStreamingAudit` hook:

### Phase 1: Discovery (`POST /api/audit/discover`)
- Fetches the top-level group and all descendant groups via `/groups/:id/descendant_groups`
- Fetches all projects in the hierarchy via `/groups/:id/projects?include_subgroups=true`
- Returns the complete list of groups and projects to audit

### Phase 2: Member fetching (`POST /api/audit/members`)
- Resources (groups + projects) are sent in batches of 5
- Each batch fetches effective members (`/members/all`) for all resources in parallel
- Results are returned per-batch; the client aggregates into a per-user view after each batch
- Inter-batch delay adapts based on GitLab's rate limit headers:
  - Normal: 2s between batches
  - Rate-limited (< 30 remaining): waits until the rate limit resets

### Client-side aggregation
- The `useStreamingAudit` hook chains discovery → looping member batches
- After each batch, `aggregateUsers()` merges per-resource memberships into a per-user view
- Users are displayed immediately (progressive rendering)
- Identical users across group/project inheritances are deduplicated, keeping the highest access level

### Token handling
- **`.env.local`** — `GITLAB_TOKEN` for default server-side token
- **Form field** — optional, overrides the server-side token when provided
- Token is sent in the POST body, never in URL params; never stored client-side

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                       # Root layout (DM Mono + DM Sans fonts)
│   ├── page.tsx                         # Main page (form + streaming results)
│   ├── globals.css                      # Theme variables, animations, dark mode
│   └── api/audit/
│       ├── discover/route.ts            # POST /api/audit/discover
│       └── members/route.ts            # POST /api/audit/members
├── components/
│   ├── AuditForm.tsx                    # Group ID + token input, submit/abort
│   ├── UserCard.tsx                     # Single user card with memberships
│   ├── UserList.tsx                     # Search, pagination, renders UserCards
│   └── LoadingIndicator.tsx             # Progress bar with phase labels
├── lib/
│   ├── gitlab/
│   │   ├── client.ts                    # Base API client (fetch, retry, pagination, rate limits)
│   │   ├── groups.ts                    # fetchGroupHierarchy
│   │   ├── projects.ts                  # fetchProjectsInHierarchy
│   │   ├── members.ts                   # fetchMembersBatch
│   │   ├── aggregate.ts                 # aggregateUsers (resource→user inversion + dedup)
│   │   └── access-levels.ts            # Access level int→string mapping
│   └── hooks/
│       └── useStreamingAudit.ts         # Client-side audit orchestration
└── types/
    └── audit.ts                         # Shared TypeScript interfaces
```

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- Vitest

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npx vitest run` | Run tests |

## GitLab API Details

- Base URL: `https://gitlab.com/api/v4`
- Authentication: `PRIVATE-TOKEN` header
- Uses REST API (not GraphQL)
- Pagination: `X-Next-Page` header, 100 items per page
- Retry with exponential backoff on 429 responses (max 3 retries)
- Rate limit headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`

## Access Levels

| Integer | String            |
|---------|-------------------|
| 5       | Minimal Access    |
| 10      | Guest             |
| 15      | Planner           |
| 20      | Reporter          |
| 25      | Security Manager  |
| 30      | Developer         |
| 40      | Maintainer        |
| 50      | Owner             |