# Cleanup and Polish Design

## Overview

Three streams of work on the GitLab Access Auditor codebase: simplify dead code, add UI improvements, and rewrite git history into a clean narrative. Execution order: code changes first (verify correctness), then git history rewrite.

## 1. Codebase Simplification

### Dead code removal

**Remove `/api/audit/aggregate/`** — route and test directory. Aggregation runs client-side in `useStreamingAudit`; no code references this endpoint.

**Remove `fetchGroupMembers`, `fetchProjectMembers`, `fetchInBatches`** from `members.ts` and their tests in `members.test.ts`. Only `fetchMembersBatch` is used by the streaming flow.

**Remove `GroupMembersResult` and `ProjectMembersResult` types** from `members.ts`. Refactor `aggregateUsers` in `aggregate.ts` to accept two flat arrays of `{ id: number; fullPath: string; members: GitLabMember[] }` (one for groups, one for projects) — the same shape as `MembersBatchResult.results` items. The hook currently maps batch results into `GroupMembersResult[]`/`ProjectMembersResult[]` before calling aggregate; after this change it passes them directly.

**Remove `swr` from `package.json` dependencies.** No code imports it.

### Doc pruning

Remove abandoned approach docs:

- `docs/superpowers/specs/2026-06-08-swr-integration-design.md`
- `docs/superpowers/plans/2026-06-08-swr-integration.md`
- `docs/superpowers/plans/2026-06-08-future-optimizations.md`
- `docs/superpowers/plans/2026-06-08-performance-optimizations.md`

SSE streaming spec/plan files were already deleted from disk when the streaming-audit work replaced them, so no SSE files need pruning.

Keep:

- `docs/superpowers/specs/2026-06-08-gitlab-access-auditor-design.md`
- `docs/superpowers/specs/2026-06-09-adaptive-rate-limit-design.md`
- `docs/superpowers/specs/2026-06-09-streaming-audit-design.md`
- `docs/superpowers/plans/2026-06-08-gitlab-access-auditor.md`
- `docs/superpowers/plans/2026-06-09-adaptive-rate-limit.md`
- `docs/superpowers/plans/2026-06-09-streaming-audit.md`

## 2. UI Improvements

### Search bar

Add a text input in the `UserList` results header area (right side, next to the "Per page" selector). Searches across: user name, username, group full paths, project full paths, and access level labels. Filtering is client-side — a user matches if any of their string fields contains the search query (case-insensitive). Empty search shows all users. Zero-match state shows a "No users match" empty state. Search resets pagination to page 1.

### Remove "X remaining" from progress text

In `LoadingIndicator`, remove `rateLimitRemaining` from the display. Change from `"Fetching members... 42% · 38 remaining"` to `"Fetching members... 42%"`. Keep `rateLimitRemaining` in `AuditProgress` type and in the hook for the adaptive delay logic — just don't render it.

### Partial results notice

**Top banner:** In `UserList`, when the audit is still streaming and results are visible, show a banner above the user cards: "Results are incomplete — group and project memberships will continue to appear as the audit progresses."

**Per-card indicator:** `UserCard` receives a `partial` boolean prop (true while streaming is in progress). When true, show a small muted text below the membership lists: "+ more memberships pending". All cards shown during streaming get this indicator.

### Expand/collapse on membership lists

In `MembershipList` inside `UserCard`, show only the first 3 items by default. If more than 3 items exist, show a "Show all X items" toggle button (styled consistently with the existing count badge). Clicking it reveals all items and changes the button text to "Show less". State is local to each `MembershipList` instance — groups and projects lists toggle independently within a card.

## 3. Git History Rewrite

After all code changes are verified (lint, typecheck, tests pass), rewrite git history as an orphan branch with 8 squashed commits, then force-push `main`.

### Target commits

| # | Message | Scope |
|---|---------|------|
| 1 | `feat: scaffold project and implement GitLab API layer` | Next.js scaffold, API client, access levels, groups, projects, member fetching, aggregation, monolithic audit endpoint — everything from initial commit through the first working version |
| 2 | `feat: add UI with audit form, results display, and pagination` | AuditForm, UserCard, LoadingIndicator, UserList, page wiring, error states |
| 3 | `style: apply industrial-refined design system with next/font` | UI redesign, ternary rendering patterns, next/font/google optimization |
| 4 | `perf: parallelize GitLab API calls and add route tests` | Promise.all group hierarchy + project fetching, API route tests |
| 5 | `docs: add assignment, design specs, and implementation plans` | Only non-abandoned docs that survive the prune |
| 6 | `feat: replace monolithic audit with streaming discover/members flow` | Streaming audit types, discover endpoint, members endpoint, useStreamingAudit hook, UI updates for streaming, removal of old monolithic endpoint |
| 7 | `feat: add adaptive rate limiting with server-side headers` | RateLimitSnapshot type, extract rate limit headers from GitLab responses, adaptive inter-batch delay, rate-limited UI phase with amber progress bar |
| 8 | `fix: polish progress indicator and compact pagination` | Percentage in progress bar label, compact pagination with ellipsis |

### Method

1. Verify all code changes pass lint, typecheck, and tests
2. Create orphan branch: `git checkout --orphan clean-main`
3. Stage the working tree incrementally in 8 commits using a scripted approach: for each target commit, `git add` only the files that belong in that logical step and commit with the specified message. Use the current file state (not git history reconstruction) to determine content — the goal is correct final state with a clean narrative, not a bit-for-bit replay of the original history.
4. Force-push: `git branch -M main` then `git push --force`

Alternatively, use `git rebase -i` with `exec` commands to squash, but the orphan approach is simpler and avoids conflicts with the dangling SSE branch commit graph.

### Stash cleanup

Drop all 4 leftover stashes (`git stash drop` x4).