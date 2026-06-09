import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

vi.mock("@/lib/gitlab/members", () => ({
  fetchMembersBatch: vi.fn(),
}));

import { fetchMembersBatch } from "@/lib/gitlab/members";

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/audit/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/audit/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = "env-token";
  });

  it("returns members for a batch of resources", async () => {
    const batchResult = {
      results: [
        { id: 42, fullPath: "my-group", members: [{ id: 1, username: "alice", name: "Alice", accessLevel: 30 }] },
      ],
    };
    vi.mocked(fetchMembersBatch).mockResolvedValue(batchResult as any);

    const response = await POST(createRequest({
      resources: [{ type: "group", id: 42, fullPath: "my-group" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results).toEqual(batchResult.results);
  });

  it("passes token from request body", async () => {
    vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [] } as any);

    await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
      token: "custom-token",
    }));

    expect(fetchMembersBatch).toHaveBeenCalledWith(
      [{ type: "group", id: 1, fullPath: "g" }],
      "https://gitlab.com/api/v4",
      "custom-token"
    );
  });

  it("returns 400 when resources array is missing", async () => {
    const response = await POST(createRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Resources array is required");
  });

  it("returns 400 when resources batch exceeds 5", async () => {
    const resources = Array.from({ length: 6 }, (_, i) => ({ type: "group" as const, id: i, fullPath: `g${i}` }));
    const response = await POST(createRequest({ resources }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Resource batch exceeds maximum size of 5");
  });

  it("returns 400 when no token is available", async () => {
    delete process.env.GITLAB_TOKEN;
    const response = await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("No access token provided");
  });

  it("passes through GitLab API errors with status", async () => {
    const err = new Error("429 Too Many Requests");
    Object.assign(err, { status: 429, retryAfter: 10 });
    vi.mocked(fetchMembersBatch).mockRejectedValue(err);

    const response = await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toBe("429 Too Many Requests");
    expect(data.retryAfter).toBe(10);
  });

  it("returns rate limit info when available", async () => {
    const rateLimit = { limit: 500, remaining: 480, resetAt: 1700000000 };
    vi.mocked(fetchMembersBatch).mockResolvedValue({ results: [], rateLimit } as any);

    const response = await POST(createRequest({
      resources: [{ type: "group", id: 1, fullPath: "g" }],
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.rateLimit).toEqual(rateLimit);
  });
});