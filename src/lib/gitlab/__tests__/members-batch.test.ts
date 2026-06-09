import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMembersBatch } from "../members";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

import { createGitLabClient } from "../client";

describe("fetchMembersBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches members for a batch of group resources", async () => {
    const mockClient = {
      fetchAllPages: vi.fn().mockResolvedValue({
        data: [
          { id: 1, username: "alice", name: "Alice", access_level: 30 },
        ],
        rateLimit: undefined,
      }),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);

    const result = await fetchMembersBatch(
      [{ type: "group" as const, id: 42, fullPath: "my-group" }],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe(42);
    expect(result.results[0].fullPath).toBe("my-group");
    expect(result.results[0].members).toEqual([
      { id: 1, username: "alice", name: "Alice", accessLevel: 30 },
    ]);
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith("/groups/42/members/all");
  });

  it("fetches members for project resources using projects endpoint", async () => {
    const mockClient = {
      fetchAllPages: vi.fn().mockResolvedValue({
        data: [
          { id: 2, username: "bob", name: "Bob", access_level: 40 },
        ],
        rateLimit: undefined,
      }),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);

    const result = await fetchMembersBatch(
      [{ type: "project" as const, id: 99, fullPath: "my-group/my-project" }],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(mockClient.fetchAllPages).toHaveBeenCalledWith("/projects/99/members/all");
    expect(result.results[0].members[0].accessLevel).toBe(40);
  });

  it("handles mixed group and project resources", async () => {
    const mockClient = {
      fetchAllPages: vi.fn()
        .mockResolvedValueOnce({ data: [{ id: 1, username: "alice", name: "Alice", access_level: 30 }], rateLimit: undefined })
        .mockResolvedValueOnce({ data: [{ id: 2, username: "bob", name: "Bob", access_level: 40 }], rateLimit: undefined }),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);

    const result = await fetchMembersBatch(
      [
        { type: "group" as const, id: 10, fullPath: "group-a" },
        { type: "project" as const, id: 20, fullPath: "group-a/proj-b" },
      ],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(result.results).toHaveLength(2);
  });

  it("returns rate limit info from the client", async () => {
    const rateLimitSnapshot = { limit: 500, remaining: 495, resetAt: 1700000000 };
    const mockClient = {
      fetchAllPages: vi.fn().mockResolvedValue({
        data: [
          { id: 1, username: "alice", name: "Alice", access_level: 30 },
        ],
        rateLimit: rateLimitSnapshot,
      }),
    };
    vi.mocked(createGitLabClient).mockReturnValue(mockClient as unknown as ReturnType<typeof createGitLabClient>);

    const result = await fetchMembersBatch(
      [{ type: "group" as const, id: 42, fullPath: "my-group" }],
      "https://gitlab.com/api/v4",
      "test-token"
    );

    expect(result.rateLimit).toEqual(rateLimitSnapshot);
  });
});