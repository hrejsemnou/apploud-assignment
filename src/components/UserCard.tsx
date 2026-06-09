import { useState } from "react";
import { Folder, FolderGit2 } from "lucide-react";
import type { UserData } from "@/types/audit";

type UserCardProps = UserData & { partial?: boolean };

const ACCESS_LEVEL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  Owner: { bg: "bg-accent-soft", text: "text-accent", label: "Owner" },
  Maintainer: { bg: "bg-success-soft", text: "text-success", label: "Maintainer" },
  Developer: { bg: "bg-warning-soft", text: "text-warning", label: "Developer" },
  Reporter: { bg: "bg-danger-soft", text: "text-danger", label: "Reporter" },
  Guest: { bg: "bg-surface", text: "text-muted", label: "Guest" },
};

function getAccessStyle(level: string) {
  return ACCESS_LEVEL_STYLES[level] ?? { bg: "bg-surface", text: "text-muted", label: level };
}

function AccessBadge({ level }: { level: string }) {
  const style = getAccessStyle(level);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-display font-medium tracking-wide uppercase ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

const COLLAPSED_LIMIT = 3;

function MembershipList({
  items,
  label,
  icon,
}: {
  items: { fullPath: string; accessLevel: string }[];
  label: string;
  icon: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_LIMIT);
  const hasMore = items.length > COLLAPSED_LIMIT;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h4 className="text-xs font-display font-medium tracking-wider uppercase text-muted">
          {label}
        </h4>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {visibleItems.map((item) => (
          <li
            key={item.fullPath}
            className="flex items-center gap-2 rounded-lg px-3 py-2 bg-surface border border-border/60"
          >
            <span className="text-sm font-display text-foreground/80 break-all leading-snug flex-1 min-w-0">
              {item.fullPath}
            </span>
            <AccessBadge level={item.accessLevel} />
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs font-display font-medium text-muted hover:text-foreground transition-colors"
        >
          {expanded ? "Show less" : `Show all ${items.length} items`}
        </button>
      ) : null}
    </div>
  );
}

export function UserCard({ name, username, groups, projects, partial }: UserCardProps) {
  const hasMemberships = groups.length > 0 || projects.length > 0;

  return (
    <article className="rounded-xl border border-border bg-surface-elevated overflow-hidden transition-shadow hover:shadow-md">
      <div className="px-5 py-4 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center shrink-0">
            <span className="text-sm font-semibold text-accent font-display">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground leading-snug truncate">
              {name}
            </h3>
            <p className="text-sm font-display text-muted leading-snug">
              @{username}
            </p>
          </div>
        </div>
      </div>

      {!hasMemberships ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-muted italic">No group or project memberships</p>
          {partial ? (
            <p className="mt-2 text-xs text-muted">+ more memberships pending</p>
          ) : null}
        </div>
      ) : (
        <div className="p-5 space-y-5">
          <MembershipList items={groups} label="Groups" icon={<Folder className="w-3.5 h-3.5 text-muted" />} />
          <MembershipList items={projects} label="Projects" icon={<FolderGit2 className="w-3.5 h-3.5 text-muted" />} />
          {partial ? (
            <p className="text-xs text-muted">+ more memberships pending</p>
          ) : null}
        </div>
      )}
    </article>
  );
}