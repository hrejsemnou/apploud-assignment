"use client";

import { useState } from "react";
import { UserCard } from "./UserCard";
import type { UserData } from "@/types/audit";

const PER_PAGE_OPTIONS = [20, 50, 100];

interface UserListProps {
  users: UserData[];
  totalUsers: number;
  isLoading?: boolean;
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [1];

  if (current > 3) {
    pages.push("...");
  }

  const rangeStart = Math.max(2, current - 1);
  const rangeEnd = Math.min(total - 1, current + 1);

  for (let i = rangeStart; i <= rangeEnd; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("...");
  }

  pages.push(total);

  return pages;
}

export function UserList({ users, totalUsers, isLoading }: UserListProps) {
  const [perPage, setPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState("");

  const query = search.toLowerCase().trim();
  const filteredUsers = query
    ? users.filter((user) => {
        const fields = [
          user.name,
          user.username,
          ...user.groups.map((g) => `${g.fullPath} ${g.accessLevel}`),
          ...user.projects.map((p) => `${p.fullPath} ${p.accessLevel}`),
        ];
        return fields.some((f) => f.toLowerCase().includes(query));
      })
    : users;

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / perPage));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * perPage;
  const end = Math.min(start + perPage, filteredUsers.length);
  const pageUsers = filteredUsers.slice(start, start + perPage);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  if (totalUsers === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-full bg-surface border border-border mx-auto flex items-center justify-center mb-4">
          <span className="text-xl">∅</span>
        </div>
        <p className="text-sm text-muted">No members found in this group hierarchy.</p>
      </div>
    );
  }

  return (
    <div>
      {isLoading && totalUsers > 0 ? (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 animate-slide-down">
          <p className="text-sm text-warning">
            Results are incomplete — group and project memberships will continue to appear as the audit progresses
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-sm font-medium tracking-wider uppercase text-muted">
            Results
          </h2>
          <span className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-display font-medium text-accent tabular-nums">
            {filteredUsers.length === totalUsers
              ? `${totalUsers} ${totalUsers === 1 ? "user" : "users"}`
              : `${filteredUsers.length} of ${totalUsers} users`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search users..."
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-display text-foreground placeholder:text-muted/50 w-full sm:w-48 transition-colors hover:border-border-strong focus:border-accent focus:ring-0"
          />
          <span className="font-display">Showing {start + 1}–{end}</span>
          <span className="text-border">|</span>
          <label htmlFor="per-page" className="sr-only">
            Per page
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Per page</span>
            <select
              id="per-page"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-display text-foreground cursor-pointer hover:border-border-strong transition-colors"
            >
              {PER_PAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted">No users match your search.</p>
        </div>
      ) : (
      <div className="space-y-4">
        {pageUsers.map((user, i) => (
          <div key={user.id} className="animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>
            <UserCard
              id={user.id}
              name={user.name}
              username={user.username}
              groups={user.groups}
              projects={user.projects}
              partial={isLoading}
            />
          </div>
        ))}
      </div>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-center gap-3 mt-8 pt-6 border-t border-border"
          aria-label="Pagination"
        >
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Previous
          </button>
          <div className="flex items-center gap-1.5">
            {getPageNumbers(safePage, totalPages).map((page, i) =>
              page === "..." ? (
                <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-muted select-none">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg text-sm font-display font-medium transition-colors ${
                    page === safePage
                      ? "bg-accent text-white shadow-sm"
                      : "text-muted hover:bg-surface-elevated hover:text-foreground"
                  }`}
                >
                  {page}
                </button>
              )
            )}
          </div>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
