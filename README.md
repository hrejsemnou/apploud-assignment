# GitLab Access Auditor

A single-page tool to audit user access across GitLab groups and projects. Enter a top-level group ID and get a complete list of all users with effective access to that group, its subgroups, and its projects — including their access levels.

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
3. Click **Audit Access**
4. Browse the results — user cards show name, username, group memberships, and project memberships with access levels

## Architecture

- **Server-side fetching** via a single `POST /api/audit` REST endpoint
- Walks the GitLab group hierarchy using `/descendant_groups`
- Fetches projects with `include_subgroups=true`
- Fetches effective members (including inherited) via `/members/all`
- Batches requests in groups of 15 for rate-limit safety
- Aggregates per-resource memberships into a per-user view
- Client renders user cards with client-side pagination

## Tech Stack

- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Vitest

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npx vitest run` | Run tests |

## GitLab API Details

- Base URL: `https://gitlab.com/api/v4`
- Authentication: `PRIVATE-TOKEN` header
- Uses REST API (not GraphQL)
- Pagination: `x-next-page` header, 100 items per page
- Retry with exponential backoff on 429 responses