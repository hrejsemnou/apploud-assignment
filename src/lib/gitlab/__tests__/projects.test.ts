import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchProjectsInHierarchy } from "../projects";
import { createGitLabClient } from "../client";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

describe("fetchProjectsInHierarchy", () => {
  let mockFetchAllPages: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchAllPages = vi.fn();
    (createGitLabClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchAllPages: mockFetchAllPages,
    });
  });

  it("fetches all projects in group hierarchy", async () => {
    const projects = [
      { id: 10, path_with_namespace: "top-group/project-1", name: "Project 1" },
      { id: 11, path_with_namespace: "top-group/sub1/project-2", name: "Project 2" },
    ];

    mockFetchAllPages.mockResolvedValueOnce({ data: projects, rateLimit: undefined });

    const result = await fetchProjectsInHierarchy("1", "https://gitlab.com", "token");

    expect(result.projects).toEqual([
      { id: 10, fullPath: "top-group/project-1", name: "Project 1" },
      { id: 11, fullPath: "top-group/sub1/project-2", name: "Project 2" },
    ]);
  });

  it("returns empty array when no projects", async () => {
    mockFetchAllPages.mockResolvedValueOnce({ data: [], rateLimit: undefined });

    const result = await fetchProjectsInHierarchy("1", "https://gitlab.com", "token");

    expect(result.projects).toEqual([]);
  });

  it("calls correct API endpoint with include_subgroups", async () => {
    mockFetchAllPages.mockResolvedValueOnce({ data: [], rateLimit: undefined });

    await fetchProjectsInHierarchy("42", "https://gitlab.com/api/v4", "token");

    expect(mockFetchAllPages).toHaveBeenCalledWith(
      "/groups/42/projects?include_subgroups=true&simple=true"
    );
  });
});