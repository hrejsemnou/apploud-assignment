import { accessLevelToString, ACCESS_LEVEL_RANK } from "./access-levels";
import type { UserData } from "@/types/audit";

interface MemberResult {
  id: number;
  fullPath: string;
  members: { id: number; username: string; name: string; accessLevel: number }[];
}

/**
 * Keep the highest access level when the same fullPath appears multiple times.
 * GitLab returns both direct and inherited memberships, so a user can appear
 * in the same group/project with different access levels.
 */
function dedupeByFullPath(
  items: { fullPath: string; accessLevel: string }[]
): { fullPath: string; accessLevel: string }[] {
  const best = new Map<string, string>();
  for (const item of items) {
    const prev = best.get(item.fullPath);
    const prevRank = prev ? (ACCESS_LEVEL_RANK[prev] ?? 0) : 0;
    const curRank = ACCESS_LEVEL_RANK[item.accessLevel] ?? 0;
    if (curRank > prevRank) best.set(item.fullPath, item.accessLevel);
  }
  return Array.from(best.entries()).map(([fullPath, accessLevel]) => ({
    fullPath,
    accessLevel,
  }));
}

export function aggregateUsers(
  groupMembers: MemberResult[],
  projectMembers: MemberResult[]
): UserData[] {
  const userMap = new Map<number, UserData>();

  function ensureUser(id: number, name: string, username: string): UserData {
    if (!userMap.has(id)) {
      userMap.set(id, { id, name, username, groups: [], projects: [] });
    }
    return userMap.get(id)!;
  }

  for (const group of groupMembers) {
    for (const member of group.members) {
      const user = ensureUser(member.id, member.name, member.username);
      user.groups.push({
        fullPath: group.fullPath,
        accessLevel: accessLevelToString(member.accessLevel),
      });
    }
  }

  for (const project of projectMembers) {
    for (const member of project.members) {
      const user = ensureUser(member.id, member.name, member.username);
      user.projects.push({
        fullPath: project.fullPath,
        accessLevel: accessLevelToString(member.accessLevel),
      });
    }
  }

  // Deduplicate — same user can inherit + have direct access to the same path
  for (const user of userMap.values()) {
    user.groups = dedupeByFullPath(user.groups);
    user.projects = dedupeByFullPath(user.projects);
  }

  return Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
