import { createGitLabClient } from "./client";
import type { RateLimitSnapshot } from "@/types/audit";

export interface GitLabGroup {
  id: number;
  fullPath: string;
  name: string;
}

export async function fetchGroupHierarchy(
  groupId: string,
  baseUrl: string,
  token: string
): Promise<{ groups: GitLabGroup[]; rateLimit?: RateLimitSnapshot }> {
  const client = createGitLabClient(baseUrl, token);

  const [{ data: topGroup, rateLimit: rl1 }, { data: descendantsRaw, rateLimit: rl2 }] = await Promise.all([
    client.fetchOne<{
      id: number;
      full_path: string;
      name: string;
    }>(`/groups/${groupId}`),
    client.fetchAllPages<{
      id: number;
      full_path: string;
      name: string;
    }>(`/groups/${groupId}/descendant_groups`),
  ]);

  const normalize = (g: { id: number; full_path: string; name: string }): GitLabGroup => ({
    id: g.id,
    fullPath: g.full_path,
    name: g.name,
  });

  return { groups: [normalize(topGroup), ...descendantsRaw.map(normalize)], rateLimit: rl2 ?? rl1 };
}