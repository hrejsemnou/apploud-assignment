import { accessLevelToString } from "./access-levels";
import type { GitLabMember } from "./members";

export interface UserAccess {
  id: number;
  name: string;
  username: string;
  groups: { fullPath: string; accessLevel: string }[];
  projects: { fullPath: string; accessLevel: string }[];
}

interface MemberResult {
  id: number;
  fullPath: string;
  members: GitLabMember[];
}

export function aggregateUsers(
  groupMembers: MemberResult[],
  projectMembers: MemberResult[]
): UserAccess[] {
  const userMap = new Map<number, UserAccess>();

  function ensureUser(id: number, name: string, username: string): UserAccess {
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

  return Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
