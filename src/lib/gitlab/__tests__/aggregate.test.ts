import { describe, it, expect } from "vitest";
import { aggregateUsers } from "../aggregate";

describe("aggregateUsers", () => {
  it("aggregates single group membership", () => {
    const groupMembers = [
      {
        id: 1,
        fullPath: "top-group",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 50 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, []);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [{ fullPath: "top-group", accessLevel: "Owner" }],
        projects: [],
      },
    ]);
  });

  it("aggregates group and project memberships for same user", () => {
    const groupMembers = [
      {
        id: 1,
        fullPath: "top-group/sub1",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 10 },
        ],
      },
    ];
    const projectMembers = [
      {
        id: 20,
        fullPath: "top-group/project-1",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 30 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [{ fullPath: "top-group/sub1", accessLevel: "Guest" }],
        projects: [{ fullPath: "top-group/project-1", accessLevel: "Developer" }],
      },
    ]);
  });

  it("merges multiple group memberships for same user", () => {
    const groupMembers = [
      {
        id: 1,
        fullPath: "top-group",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 50 },
        ],
      },
      {
        id: 2,
        fullPath: "top-group/sub1",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 10 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, []);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [
          { fullPath: "top-group", accessLevel: "Owner" },
          { fullPath: "top-group/sub1", accessLevel: "Guest" },
        ],
        projects: [],
      },
    ]);
  });

  it("returns empty array for no members", () => {
    const result = aggregateUsers([], []);
    expect(result).toEqual([]);
  });

  it("sorts users by name", () => {
    const groupMembers = [
      {
        id: 1,
        fullPath: "top-group",
        members: [
          { id: 20, username: "user2", name: "Zeta User", accessLevel: 10 },
          { id: 10, username: "user1", name: "Alpha User", accessLevel: 50 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, []);

    expect(result[0].name).toBe("Alpha User");
    expect(result[1].name).toBe("Zeta User");
  });

  it("handles multiple users with multiple projects", () => {
    const projectMembers = [
      {
        id: 1,
        fullPath: "g/p1",
        members: [
          { id: 10, username: "a", name: "Alice", accessLevel: 30 },
          { id: 20, username: "b", name: "Bob", accessLevel: 10 },
        ],
      },
      {
        id: 2,
        fullPath: "g/p2",
        members: [
          { id: 10, username: "a", name: "Alice", accessLevel: 40 },
        ],
      },
    ];

    const result = aggregateUsers([], projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "Alice",
        username: "a",
        groups: [],
        projects: [
          { fullPath: "g/p1", accessLevel: "Developer" },
          { fullPath: "g/p2", accessLevel: "Maintainer" },
        ],
      },
      {
        id: 20,
        name: "Bob",
        username: "b",
        groups: [],
        projects: [{ fullPath: "g/p1", accessLevel: "Guest" }],
      },
    ]);
  });

  it("deduplicates same fullPath keeping highest access level", () => {
    // Simulates GitLab returning both inherited (Guest) and direct (Developer)
    // memberships for the same group/project path
    const groupMembers = [
      {
        id: 1,
        fullPath: "gitlab-org/prometheus/gcp-cloud-nat-exporter",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 10 },
        ],
      },
      {
        id: 1,
        fullPath: "gitlab-org/prometheus/gcp-cloud-nat-exporter",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 30 },
        ],
      },
    ];

    const result = aggregateUsers(groupMembers, []);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [
          { fullPath: "gitlab-org/prometheus/gcp-cloud-nat-exporter", accessLevel: "Developer" },
        ],
        projects: [],
      },
    ]);
  });

  it("deduplicates project paths keeping highest access level", () => {
    const projectMembers = [
      {
        id: 1,
        fullPath: "g/project",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 20 },
        ],
      },
      {
        id: 1,
        fullPath: "g/project",
        members: [
          { id: 10, username: "user1", name: "User One", accessLevel: 50 },
        ],
      },
    ];

    const result = aggregateUsers([], projectMembers);

    expect(result).toEqual([
      {
        id: 10,
        name: "User One",
        username: "user1",
        groups: [],
        projects: [{ fullPath: "g/project", accessLevel: "Owner" }],
      },
    ]);
  });
});
