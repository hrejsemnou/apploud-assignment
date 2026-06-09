import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

vi.mock("@/lib/gitlab/groups", () => ({
  fetchGroupHierarchy: vi.fn(),
}));

vi.mock("@/lib/gitlab/projects", () => ({
  fetchProjectsInHierarchy: vi.fn(),
}));

import { fetchGroupHierarchy } from "@/lib/gitlab/groups";
import { fetchProjectsInHierarchy } from "@/lib/gitlab/projects";

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/audit/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/audit/discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = "env-token";
  });

  it("returns groups and projects", async () => {
    const groups = [{ id: 1, fullPath: "g", name: "G" }];
    const projects = [{ id: 10, fullPath: "g/p", name: "P" }];

    vi.mocked(fetchGroupHierarchy).mockResolvedValue({ groups, rateLimit: undefined });
    vi.mocked(fetchProjectsInHierarchy).mockResolvedValue({ projects, rateLimit: undefined });

    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.groups).toEqual(groups);
    expect(data.projects).toEqual(projects);
  });

  it("returns 400 when groupId is missing", async () => {
    const response = await POST(createRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Group ID is required");
  });

  it("returns 400 when no token is provided", async () => {
    delete process.env.GITLAB_TOKEN;
    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("No access token provided");
  });

  it("passes through GitLab API errors with status", async () => {
    const err = new Error("401 Unauthorized");
    Object.assign(err, { status: 401 });
    vi.mocked(fetchGroupHierarchy).mockRejectedValue(err);

    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("401 Unauthorized");
  });

  it("returns rate limit info when available", async () => {
    const groups = [{ id: 1, fullPath: "g", name: "G" }];
    const projects = [{ id: 10, fullPath: "g/p", name: "P" }];
    const rateLimit = { limit: 500, remaining: 490, resetAt: 1700000000 };

    vi.mocked(fetchGroupHierarchy).mockResolvedValue({ groups, rateLimit });
    vi.mocked(fetchProjectsInHierarchy).mockResolvedValue({ projects, rateLimit: undefined });

    const response = await POST(createRequest({ groupId: "1" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.rateLimit).toEqual(rateLimit);
  });
});