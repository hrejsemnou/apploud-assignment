import { createGitLabClient } from "./client";
import type { RateLimitSnapshot } from "@/types/audit";

export interface GitLabProject {
  id: number;
  fullPath: string;
  name: string;
}

export async function fetchProjectsInHierarchy(
  groupId: string,
  baseUrl: string,
  token: string
): Promise<{ projects: GitLabProject[]; rateLimit?: RateLimitSnapshot }> {
  const client = createGitLabClient(baseUrl, token);

  const { data: raw, rateLimit } = await client.fetchAllPages<{
    id: number;
    path_with_namespace: string;
    name: string;
  }>(`/groups/${groupId}/projects?include_subgroups=true&simple=true`);

  return {
    projects: raw.map((p) => ({
      id: p.id,
      fullPath: p.path_with_namespace,
      name: p.name,
    })),
    rateLimit,
  };
}