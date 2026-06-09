import { NextRequest, NextResponse } from "next/server";
import { fetchMembersBatch, MemberResource } from "@/lib/gitlab/members";
import { handleApiError } from "@/lib/gitlab/errors";

const GITLAB_BASE_URL = "https://gitlab.com/api/v4";
const MAX_BATCH_SIZE = 5;

export async function POST(request: NextRequest) {
  let body: { resources?: MemberResource[]; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { resources, token } = body;

  if (!resources || !Array.isArray(resources)) {
    return NextResponse.json({ error: "Resources array is required" }, { status: 400 });
  }

  if (resources.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: "Resource batch exceeds maximum size of 5" }, { status: 400 });
  }

  const gitlabToken = token || process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    return NextResponse.json({ error: "No access token provided" }, { status: 400 });
  }

  try {
    const { results, rateLimit } = await fetchMembersBatch(resources, GITLAB_BASE_URL, gitlabToken);
    return NextResponse.json({ results, rateLimit });
  } catch (err: unknown) {
    const { status, message, retryAfter } = handleApiError(err);
    return NextResponse.json({ error: message, retryAfter }, { status });
  }
}