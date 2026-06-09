import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGroupHierarchy } from "../groups";
import { createGitLabClient } from "../client";

vi.mock("../client", () => ({
  createGitLabClient: vi.fn(),
}));

describe("fetchGroupHierarchy", () => {
  let mockFetchOne: ReturnType<typeof vi.fn>;
  let mockFetchAllPages: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchOne = vi.fn();
    mockFetchAllPages = vi.fn();
    (createGitLabClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchOne: mockFetchOne,
      fetchAllPages: mockFetchAllPages,
    });
  });

  it("fetches top-level group and descendant groups", async () => {
    const topGroup = { id: 1, full_path: "top-group", name: "Top Group" };
    const descendants = [
      { id: 2, full_path: "top-group/sub1", name: "Sub 1" },
      { id: 3, full_path: "top-group/sub2", name: "Sub 2" },
    ];

    mockFetchOne.mockResolvedValue({ data: topGroup, rateLimit: undefined });
    mockFetchAllPages.mockResolvedValue({ data: descendants, rateLimit: undefined });

    const result = await fetchGroupHierarchy("1", "https://gitlab.com/api/v4", "token");

    expect(result.groups).toEqual([
      { id: 1, fullPath: "top-group", name: "Top Group" },
      { id: 2, fullPath: "top-group/sub1", name: "Sub 1" },
      { id: 3, fullPath: "top-group/sub2", name: "Sub 2" },
    ]);
  });

  it("includes only top-level group when no descendants", async () => {
    const topGroup = { id: 1, full_path: "top-group", name: "Top Group" };

    mockFetchOne.mockResolvedValue({ data: topGroup, rateLimit: undefined });
    mockFetchAllPages.mockResolvedValue({ data: [], rateLimit: undefined });

    const result = await fetchGroupHierarchy("1", "https://gitlab.com/api/v4", "token");

    expect(result.groups).toEqual([{ id: 1, fullPath: "top-group", name: "Top Group" }]);
  });

  it("calls correct API endpoints", async () => {
    mockFetchOne.mockResolvedValue({ data: { id: 1, full_path: "g", name: "G" }, rateLimit: undefined });
    mockFetchAllPages.mockResolvedValue({ data: [], rateLimit: undefined });

    await fetchGroupHierarchy("42", "https://gitlab.com/api/v4", "token");

    expect(mockFetchOne).toHaveBeenCalledWith("/groups/42");
    expect(mockFetchAllPages).toHaveBeenCalledWith("/groups/42/descendant_groups");
  });
});