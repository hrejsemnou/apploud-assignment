"use client";

import { useState, useRef, useCallback } from "react";
import type { AuditResult, AuditProgress, DiscoverResult, MembersBatchResult, RateLimitSnapshot } from "@/types/audit";
import { aggregateUsers } from "@/lib/gitlab/aggregate";
import { GitLabApiError } from "@/lib/gitlab/errors";

interface AuditArgs {
  groupId: string;
  token?: string;
  initialDelay?: number;
}

const BATCH_SIZE = 5;
const RATE_LIMIT_THRESHOLD = 30;

export function computeDelay(rateLimit: RateLimitSnapshot | undefined, baseDelay: number): number {
  if (!rateLimit || rateLimit.remaining >= RATE_LIMIT_THRESHOLD) {
    return baseDelay;
  }
  const secondsUntilReset = Math.max(0, rateLimit.resetAt - Math.floor(Date.now() / 1000) + 1);
  return Math.max(baseDelay, secondsUntilReset * 1000);
}

async function postJSON<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new GitLabApiError(
      response.status,
      data.error ?? "Unknown error",
      data.retryAfter
    );
  }

  return data as T;
}

export function useStreamingAudit() {
  const [data, setData] = useState<AuditResult | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const abortRef = useRef(false);
  const rateLimitRef = useRef<RateLimitSnapshot | undefined>(undefined);
  const progressRef = useRef<AuditProgress | null>(null);
  const baseDelayRef = useRef(2000);

  const setProgressWithRef = useCallback((p: AuditProgress | null) => {
    progressRef.current = p;
    setProgress(p);
  }, []);

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
    setProgressWithRef(null);
    abortRef.current = false;
    rateLimitRef.current = undefined;
    progressRef.current = null;
  }, [setProgressWithRef]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const trigger = useCallback(async (args: AuditArgs) => {
    baseDelayRef.current = args.initialDelay ?? 2000;
    abortRef.current = false;
    setData(undefined);
    setError(undefined);
    setIsLoading(true);
    setProgressWithRef(null);

    try {
      const token = args.token || undefined;

      setProgressWithRef({ current: 0, total: 0, phase: "discovering" });
      const discoverResult = await postJSON<DiscoverResult>("/api/audit/discover", {
        groupId: args.groupId,
        token,
      });

      if (discoverResult.rateLimit) {
        rateLimitRef.current = discoverResult.rateLimit;
      }

      if (abortRef.current) {
        setIsLoading(false);
        setProgressWithRef(null);
        return;
      }

      const allResources = [
        ...discoverResult.groups.map((g) => ({ type: "group" as const, id: g.id, fullPath: g.fullPath })),
        ...discoverResult.projects.map((p) => ({ type: "project" as const, id: p.id, fullPath: p.fullPath })),
      ];

      const total = allResources.length;
      const allGroupMembers: { id: number; fullPath: string; members: MembersBatchResult["results"][number]["members"] }[] = [];
      const allProjectMembers: { id: number; fullPath: string; members: MembersBatchResult["results"][number]["members"] }[] = [];

      for (let i = 0; i < total; i += BATCH_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 0));

        if (abortRef.current) {
          setIsLoading(false);
          setProgressWithRef(null);
          return;
        }

        const batch = allResources.slice(i, i + BATCH_SIZE);

        const batchResult = await postJSON<MembersBatchResult>("/api/audit/members", {
          resources: batch,
          token,
        });

        if (batchResult.rateLimit) {
          rateLimitRef.current = batchResult.rateLimit;
        }

        batch.forEach((resource, idx) => {
          const result = batchResult.results[idx];
          if (!result) return;

          if (resource.type === "group") {
            allGroupMembers.push({ id: result.id, fullPath: result.fullPath, members: result.members });
          } else {
            allProjectMembers.push({ id: result.id, fullPath: result.fullPath, members: result.members });
          }
        });

        const users = aggregateUsers(allGroupMembers, allProjectMembers);
        setData({ users, totalUsers: users.length });

        const completedCount = Math.min(i + BATCH_SIZE, total);
        setProgressWithRef({ current: completedCount, total, phase: "fetching-members", rateLimitRemaining: rateLimitRef.current?.remaining });

        if (i + BATCH_SIZE < total) {
          const delay = computeDelay(rateLimitRef.current, baseDelayRef.current);
          if (delay > baseDelayRef.current) {
            setProgressWithRef({ current: completedCount, total, phase: "rate-limited", rateLimitRemaining: rateLimitRef.current?.remaining });
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      setProgressWithRef(null);
    } catch (err: unknown) {
      if (err instanceof GitLabApiError && err.retryAfter != null) {
        setProgressWithRef({ current: progressRef.current?.current ?? 0, total: progressRef.current?.total ?? 0, phase: "rate-limited", rateLimitRemaining: rateLimitRef.current?.remaining });
        await new Promise((resolve) => setTimeout(resolve, err.retryAfter! * 1000));
      }
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setProgressWithRef(null);
    } finally {
      setIsLoading(false);
    }
  }, [setProgressWithRef]);

  return { trigger, abort, data, error, isLoading, progress, reset };
}