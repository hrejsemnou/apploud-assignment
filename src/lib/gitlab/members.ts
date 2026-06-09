import { createGitLabClient } from "./client";
import type { RateLimitSnapshot, MembersBatchResult } from "@/types/audit";

export interface MemberResource {
  type: "group" | "project";
  id: number;
  fullPath: string;
}

export async function fetchMembersBatch(
  resources: MemberResource[],
  baseUrl: string,
  token: string
): Promise<MembersBatchResult> {
  const client = createGitLabClient(baseUrl, token);
  let lastRateLimit: RateLimitSnapshot | undefined;

  const results = await Promise.all(
    resources.map(async (resource) => {
      const endpoint = resource.type === "group"
        ? `/groups/${resource.id}/members/all`
        : `/projects/${resource.id}/members/all`;

      const { data: raw, rateLimit } = await client.fetchAllPages<{
        id: number;
        username: string;
        name: string;
        access_level: number;
      }>(endpoint);

      if (rateLimit) lastRateLimit = rateLimit;

      return {
        id: resource.id,
        fullPath: resource.fullPath,
        members: raw.map((m) => ({
          id: m.id,
          username: m.username,
          name: m.name,
          accessLevel: m.access_level,
        })),
      };
    })
  );

  return { results, rateLimit: lastRateLimit };
}
