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
  rateLimit?: RateLimitSnapshot;
}

export interface MembersBatchResult {
  results: Array<{
    id: number;
    fullPath: string;
    members: { id: number; username: string; name: string; accessLevel: number }[];
  }>;
  rateLimit?: RateLimitSnapshot;
}

export interface AuditProgress {
  current: number;
  total: number;
  phase: "discovering" | "fetching-members" | "aggregating" | "rate-limited";
  rateLimitRemaining?: number;
}

export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}