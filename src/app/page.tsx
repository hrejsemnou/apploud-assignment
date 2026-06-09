"use client";

import { AuditForm } from "@/components/AuditForm";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { UserList } from "@/components/UserList";
import { useStreamingAudit } from "@/lib/hooks/useStreamingAudit";

export default function Home() {
  const { trigger, abort, data, error, isLoading, progress, reset } = useStreamingAudit();

  function handleAudit(groupId: string, token: string) {
    trigger({ groupId, token: token || undefined });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-surface-elevated">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" />
            <span className="font-display text-xs tracking-wider uppercase text-muted">
              Access Audit Tool
            </span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-medium tracking-tight text-foreground">
            GitLab Access Auditor
          </h1>
          <p className="mt-2 text-sm text-muted leading-relaxed max-w-lg">
            Inspect who has access to what across your GitLab groups and projects. Enter a group ID to start.
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {error ? (
          <div className="mb-6 rounded-lg border border-danger/30 bg-danger-soft p-4 animate-slide-down">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-danger">Audit failed</p>
                <p className="mt-1 text-sm text-danger/80">{error.message}</p>
              </div>
              <button
                onClick={reset}
                className="text-xs text-danger/60 hover:text-danger underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <AuditForm
          onSubmit={handleAudit}
          isLoading={isLoading}
          onAbort={abort}
        />

        {isLoading ? <LoadingIndicator progress={progress} /> : null}

        {data ? (
          <div className="animate-fade-in">
            <UserList users={data.users} totalUsers={data.totalUsers} isLoading={isLoading} />
            
          </div>
        ) : null}
      </div>
    </main>
  );
}