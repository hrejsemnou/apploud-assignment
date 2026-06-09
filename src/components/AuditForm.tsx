"use client";

import { useState } from "react";

interface AuditFormProps {
  onSubmit: (groupId: string, token: string) => void;
  isLoading: boolean;
  onAbort?: () => void;
}

export function AuditForm({ onSubmit, isLoading, onAbort }: AuditFormProps) {
  const [groupId, setGroupId] = useState("10975505");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(groupId, token);
  }

  return (
    <form onSubmit={handleSubmit} className="mb-10">
      <div className="rounded-xl border border-border bg-surface-elevated overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface">
          <span className="font-display text-xs tracking-wider uppercase text-muted">
            Configure Audit
          </span>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label
              htmlFor="group-id"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Group ID <span className="text-danger">*</span>
            </label>
            <input
              id="group-id"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-display text-foreground placeholder:text-muted/50 transition-colors hover:border-border-strong focus:border-accent focus:ring-0 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="e.g. 10975505"
            />
          </div>

          <div>
            <label
              htmlFor="token"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Access Token{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <div className="relative">
              <input
                id="token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 pr-16 text-sm font-display text-foreground placeholder:text-muted/50 transition-colors hover:border-border-strong focus:border-accent focus:ring-0 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Leave empty to use default token"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted hover:text-foreground transition-colors px-1"
                tabIndex={-1}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Leave empty to use the default token configured on the server
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border bg-surface flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-muted hidden sm:block">
            Results include all subgroups and projects
          </p>
          <button
            type={isLoading && onAbort ? "button" : "submit"}
            disabled={false}
            onClick={isLoading && onAbort ? onAbort : undefined}
            className="w-full sm:w-auto rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:shadow-md active:scale-[0.98]"
          >
            {isLoading && onAbort ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Cancel
              </span>
            ) : isLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Auditing...
              </span>
            ) : (
              "Run Audit"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}