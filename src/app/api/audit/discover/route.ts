import { NextRequest, NextResponse } from "next/server";
import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";
const GITLAB_BASE_URL = "https://gitlab.com/api/v4";

export async function POST(request: NextRequest) {
  let body: { groupId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { groupId, token } = body;

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  const gitlabToken = token || process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    return NextResponse.json({ error: "No access token provided" }, { status: 400 });
  }

  try {
    const [{ groups, rateLimit: rl1 }, { projects, rateLimit: rl2 }] = await Promise.all([
      fetchGroupHierarchy(groupId, GITLAB_BASE_URL, gitlabToken),
      fetchProjectsInHierarchy(groupId, GITLAB_BASE_URL, gitlabToken),
    ]);

    return NextResponse.json({ groups, projects, rateLimit: rl2 ?? rl1 });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err
      ? (err as { status: number }).status
      : 502;
    const message = err instanceof Error ? err.message : "Failed to reach GitLab API";

    return NextResponse.json({ error: message }, { status });
  }
}