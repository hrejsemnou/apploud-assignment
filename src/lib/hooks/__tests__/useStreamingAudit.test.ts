import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStreamingAudit, setInterBatchDelay, computeDelay } from "../useStreamingAudit";
import type { RateLimitSnapshot } from "@/types/audit";

vi.mock("@/lib/gitlab/aggregate", () => ({
  aggregateUsers: vi.fn().mockReturnValue([]),
}));

import { aggregateUsers } from "@/lib/gitlab/aggregate";

describe("useStreamingAudit", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    setInterBatchDelay(0);
    vi.mocked(aggregateUsers).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setInterBatchDelay(2000);
  });

  it("orchestrates discover → members → aggregate flow", async () => {
    const groups = [{ id: 1, fullPath: "g", name: "G" }];
    const projects = [{ id: 10, fullPath: "g/p", name: "P" }];
    const members = [{ id: 1, username: "alice", name: "Alice", accessLevel: 30 }];
    const aggregatedUsers = [{ id: 1, name: "Alice", username: "alice", groups: [{ fullPath: "g", accessLevel: "Developer" }], projects: [] }];

    vi.mocked(aggregateUsers).mockReturnValue(aggregatedUsers as any);

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects, rateLimit: undefined }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [{ id: 1, fullPath: "g", members }], rateLimit: undefined }) } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.totalUsers).toBe(1);
    expect(result.current.error).toBeUndefined();
    expect(aggregateUsers).toHaveBeenCalled();
  });

  it("stops on error from discover", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: false, status: 401, json: () => Promise.resolve({ error: "401 Unauthorized" }) } as Response;
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.error).toBeDefined());

    expect(result.current.error?.message).toBe("401 Unauthorized");
    expect(result.current.data).toBeUndefined();
  });

  it("sends multiple member batches for large resource sets", async () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, fullPath: `g${i}`, name: `G${i}` }));
    let membersCallCount = 0;

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [], rateLimit: undefined }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        membersCallCount++;
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [], rateLimit: undefined }) } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    // 8 groups / 5 per batch = 2 batches
    expect(membersCallCount).toBe(2);
  });

  it("resets state", async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      return { ok: true, status: 200, json: () => Promise.resolve({ groups: [], projects: [], rateLimit: undefined }) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.progress).toBeNull();
  });

  it("aborts after current batch", async () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, fullPath: `g${i}`, name: `G${i}` }));
    let membersCallCount = 0;
    let firstMembersCallResolved: () => void;
    const firstMembersCallPromise = new Promise<void>((resolve) => {
      firstMembersCallResolved = resolve;
    });

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [], rateLimit: undefined }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        membersCallCount++;
        if (membersCallCount === 1) {
          firstMembersCallResolved();
        }
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [], rateLimit: undefined }) } as Response;
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) } as Response;
    });

    const { result } = renderHook(() => useStreamingAudit());

    act(() => {
      result.current.trigger({ groupId: "1" });
    });

    await firstMembersCallPromise;

    act(() => {
      result.current.abort();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(membersCallCount).toBe(1);
  });

  it("updates data incrementally after each batch", async () => {
    const groups = [{ id: 1, fullPath: "g1", name: "G1" }, { id: 2, fullPath: "g2", name: "G2" }];
    const member1 = { id: 1, username: "alice", name: "Alice", accessLevel: 30 };
    const member2 = { id: 2, username: "bob", name: "Bob", accessLevel: 40 };

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [], rateLimit: undefined }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [{ id: 1, fullPath: "g1", members: [member1] }, { id: 2, fullPath: "g2", members: [member2] }], rateLimit: undefined }) } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    vi.mocked(aggregateUsers).mockImplementation((gm: any) => {
      const users = gm.flatMap((g: any) => g.members.map((m: any) => ({ id: m.id, name: m.name, username: m.username, groups: [], projects: [] })));
      return users;
    });

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      result.current.trigger({ groupId: "1" });
    });

    await waitFor(() => expect(result.current.data?.totalUsers).toBeGreaterThan(0));
  });

  it("waits for rate limit reset when remaining is low", async () => {
    const now = Math.floor(Date.now() / 1000);
    const resetAt = now + 5;
    const rateLimit: RateLimitSnapshot = { limit: 500, remaining: 10, resetAt };

    setInterBatchDelay(2000);

    const delay = computeDelay(rateLimit);
    expect(delay).toBeGreaterThan(2000);

    const highRemaining: RateLimitSnapshot = { limit: 500, remaining: 50, resetAt };
    expect(computeDelay(highRemaining)).toBe(2000);

    expect(computeDelay(undefined)).toBe(2000);
  });

  it("shows rate-limited phase when remaining is low", async () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, fullPath: `g${i}`, name: `G${i}` }));
    const now = Math.floor(Date.now() / 1000);
    const resetAt = now + 5;
    const rateLimit = { limit: 500, remaining: 10, resetAt };

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [], rateLimit: undefined }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ results: [], rateLimit }) } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    // Capture what setTimeout delays are used
    const setTimeoutCalls: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: any[]) => any, ms?: number) => {
      if (typeof ms === "number") {
        setTimeoutCalls.push(ms);
      }
      return origSetTimeout(fn, 0);
    }) as any);

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      await result.current.trigger({ groupId: "1" });
    });

    // Verify the hook computed a delay > interBatchDelayMs and used it
    // setInterBatchDelay was set to 0 in beforeEach, so any delay > 0 from computeDelay
    // proves the rate limit logic kicked in
    const nonZeroDelays = setTimeoutCalls.filter((ms) => ms > 0);
    expect(nonZeroDelays.length).toBeGreaterThan(0);
  });

  it("handles 429 with retryAfter from server", async () => {
    const groups = [{ id: 1, fullPath: "g1", name: "G1" }];

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/audit/discover")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ groups, projects: [], rateLimit: undefined }) } as Response;
      }
      if (url.includes("/api/audit/members")) {
        return { ok: false, status: 429, json: () => Promise.resolve({ error: "rate limited", retryAfter: 5 }) } as Response;
      }
      return { ok: false, status: 404, json: () => Promise.resolve({ error: "not found" }) } as Response;
    });

    const setTimeoutCalls: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: any[]) => any, ms?: number) => {
      if (typeof ms === "number") {
        setTimeoutCalls.push(ms);
      }
      return origSetTimeout(fn, 0);
    }) as any);

    const { result } = renderHook(() => useStreamingAudit());

    await act(async () => {
      await result.current.trigger({ groupId: "1" });
    });

    // The hook should have called setTimeout with retryAfter * 1000 = 5000ms
    expect(setTimeoutCalls).toContain(5000);

    expect(result.current.error?.message).toBe("rate limited");
    expect(result.current.progress).toBeNull();
  });
});