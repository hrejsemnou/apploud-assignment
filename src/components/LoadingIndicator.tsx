import type { AuditProgress } from "@/types/audit";

interface LoadingIndicatorProps {
  progress?: AuditProgress | null;
}

export function LoadingIndicator({ progress }: LoadingIndicatorProps) {
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const statusText = progress?.phase === "rate-limited"
    ? `Waiting for rate limit reset...`
    : progress?.phase === "fetching-members"
      ? `Fetching members... ${pct}%`
      : progress?.phase === "discovering"
        ? "Discovering groups and projects..."
        : progress?.phase === "aggregating"
          ? "Aggregating results..."
          : "Fetching members from GitLab";

  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
      </div>
      <div className="mt-5 text-center">
        <p className="text-sm font-medium text-foreground">{statusText}</p>
        {(progress?.phase === "fetching-members" || progress?.phase === "rate-limited") && (
          <div className="mt-2 w-48 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                progress?.phase === "rate-limited" ? "bg-amber-500" : "bg-accent"
              }`}
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}