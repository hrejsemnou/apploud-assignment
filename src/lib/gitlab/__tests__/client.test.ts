import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGitLabClient } from "../client";

describe("createGitLabClient", () => {
  const baseUrl = "https://gitlab.example.com/api/v4";
  const token = "test-token";
  let client: ReturnType<typeof createGitLabClient>;

  beforeEach(() => {
    client = createGitLabClient(baseUrl, token);
  });

  it("fetches a single page of results", async () => {
    const data = [{ id: 1 }, { id: 2 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          headers: new Headers(),
        } as Response)
      )
    );

    const { data: result } = await client.fetchAllPages<{ id: number }>("/groups");
    expect(result).toEqual(data);
  });

  it("paginates through multiple pages", async () => {
    const page1 = [{ id: 1 }];
    const page2 = [{ id: 2 }];
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        const headers = new Headers();
        if (callCount === 1) headers.set("x-next-page", "2");
        const data = callCount === 1 ? page1 : page2;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          headers,
        } as Response);
      })
    );

    const { data: result } = await client.fetchAllPages<{ id: number }>("/groups");
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(callCount).toBe(2);
  });

  it("fetchOne returns a single object", async () => {
    const group = { id: 1, name: "Top Group" };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(group),
          headers: new Headers(),
        } as Response)
      )
    );

    const { data: result } = await client.fetchOne<{ id: number; name: string }>("/groups/1");
    expect(result).toEqual({ id: 1, name: "Top Group" });
  });

  it("fetchOne constructs correct URL", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1 }),
        headers: new Headers(),
      } as Response)
    );
    vi.stubGlobal("fetch", fetchSpy);

    await client.fetchOne("/groups/42");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/groups/42",
      expect.objectContaining({
        headers: expect.objectContaining({ "PRIVATE-TOKEN": token }),
      })
    );
  });

  it("throws on 401 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: "401 Unauthorized" }),
          headers: new Headers(),
        } as Response)
      )
    );

    await expect(
      client.fetchAllPages("/groups")
    ).rejects.toThrow("401 Unauthorized");
  });

  it("throws on 404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ message: "404 Not Found" }),
          headers: new Headers(),
        } as Response)
      )
    );

    await expect(
      client.fetchAllPages("/groups/999")
    ).rejects.toThrow("404 Not Found");
  });

  describe("429 retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on 429 and succeeds on second attempt", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: () => Promise.resolve({ message: "rate limited" }),
              headers: new Headers(),
            } as Response);
          }
          const headers = new Headers();
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: 1 }]),
            headers,
          } as Response);
        })
      );

      const promise = client.fetchAllPages<{ id: number }>("/groups");
      await vi.advanceTimersByTimeAsync(3000);
      const { data: result } = await promise;
      expect(result).toEqual([{ id: 1 }]);
      expect(callCount).toBe(2);
    });
  });

  describe("429 retry with Retry-After header", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses Retry-After header for wait time on 429", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            const headers = new Headers();
            headers.set("Retry-After", "5");
            return Promise.resolve({
              ok: false,
              status: 429,
              json: () => Promise.resolve({ message: "rate limited" }),
              headers,
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: 1 }]),
            headers: new Headers(),
          } as Response);
        })
      );

      const client = createGitLabClient(baseUrl, token);
      const promise = client.fetchAllPages<{ id: number }>("/groups");
      await vi.advanceTimersByTimeAsync(6000);
      const { data } = await promise;
      expect(data).toEqual([{ id: 1 }]);
      expect(callCount).toBe(2);
    });

    it("GitLabApiError includes retryAfter on 429", async () => {
      let callCount = 0;
      const headers = new Headers();
      headers.set("Retry-After", "10");
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          callCount++;
          if (callCount <= 4) {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: () => Promise.resolve({ message: "rate limited" }),
              headers,
            } as Response);
          }
          return Promise.resolve({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ message: "forbidden" }),
            headers: new Headers(),
          } as Response);
        })
      );

      const { GitLabApiError } = await import("../client");
      const client = createGitLabClient(baseUrl, token);
      const promise = client.fetchAllPages("/groups");
      let caught: unknown;
      promise.catch((e) => { caught = e; });
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(15000);
      }
      await vi.runAllTimersAsync();
      expect(caught).toBeInstanceOf(GitLabApiError);
      expect((caught as any).retryAfter).toBe(10);
    });
  });

  it("sends PRIVATE-TOKEN header", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      } as Response)
    );
    vi.stubGlobal("fetch", fetchSpy);

    await client.fetchAllPages("/groups");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "PRIVATE-TOKEN": token }),
      })
    );
  });

  describe("rate limit headers", () => {
    it("fetchOne returns rate limit info from response headers", async () => {
      const headers = new Headers();
      headers.set("RateLimit-Limit", "500");
      headers.set("RateLimit-Remaining", "498");
      headers.set("RateLimit-Reset", "1700000000");

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: 1, name: "test" }),
            headers,
          } as Response)
        )
      );

      const client = createGitLabClient(baseUrl, token);
      const { data, rateLimit } = await client.fetchOne<{ id: number; name: string }>("/groups/1");
      expect(data).toEqual({ id: 1, name: "test" });
      expect(rateLimit).toEqual({ limit: 500, remaining: 498, resetAt: 1700000000 });
    });

    it("fetchAllPages returns rate limit from last page", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          callCount++;
          const headers = new Headers();
          if (callCount === 1) {
            headers.set("x-next-page", "2");
            headers.set("RateLimit-Limit", "500");
            headers.set("RateLimit-Remaining", "490");
            headers.set("RateLimit-Reset", "1700000000");
          } else {
            headers.set("RateLimit-Limit", "500");
            headers.set("RateLimit-Remaining", "485");
            headers.set("RateLimit-Reset", "1700000000");
          }
          const data = callCount === 1 ? [{ id: 1 }] : [{ id: 2 }];
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(data),
            headers,
          } as Response);
        })
      );

      const client = createGitLabClient(baseUrl, token);
      const { data, rateLimit } = await client.fetchAllPages<{ id: number }>("/groups");
      expect(data).toEqual([{ id: 1 }, { id: 2 }]);
      expect(rateLimit?.remaining).toBe(485);
    });

    it("returns undefined rateLimit when headers are absent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: 1 }),
            headers: new Headers(),
          } as Response)
        )
      );

      const client = createGitLabClient(baseUrl, token);
      const { rateLimit } = await client.fetchOne<{ id: number }>("/groups/1");
      expect(rateLimit).toBeUndefined();
    });
  });
});