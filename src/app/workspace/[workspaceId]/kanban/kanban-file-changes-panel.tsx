"use client";

import { useMemo, useState } from "react";
import type { KanbanRepoChanges, KanbanFileChangeItem, KanbanFileChangeStatus } from "./kanban-file-changes-types";

interface KanbanFileChangesPanelProps {
  repos: KanbanRepoChanges[];
  loading?: boolean;
}

const PREVIEW_FILE_LIMIT = 4;

const STATUS_BADGE: Record<KanbanFileChangeStatus, { short: string; className: string }> = {
  modified: { short: "M", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  added: { short: "A", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  deleted: { short: "D", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
  renamed: { short: "R", className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  copied: { short: "C", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  untracked: { short: "??", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  typechange: { short: "T", className: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300" },
  conflicted: { short: "U", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

function formatChangeSummary(repo: KanbanRepoChanges): string {
  if (repo.error) return "Unavailable";
  if (repo.status.clean) return "Clean";
  const segments: string[] = [];
  if (repo.status.modified > 0) segments.push(`${repo.status.modified} modified`);
  if (repo.status.untracked > 0) segments.push(`${repo.status.untracked} untracked`);
  return segments.join(" · ");
}

function FileRow({ file }: { file: KanbanFileChangeItem }) {
  const badge = STATUS_BADGE[file.status];

  return (
    <div className="flex items-start gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-2.5 py-2 dark:border-[#202433] dark:bg-[#11141d]">
      <span className={`inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>
        {badge.short}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200" title={file.path}>
          {file.path}
        </div>
        {file.previousPath && (
          <div className="truncate text-[10px] text-slate-400 dark:text-slate-500" title={file.previousPath}>
            from {file.previousPath}
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanFileChangesPanel({ repos, loading = false }: KanbanFileChangesPanelProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});
  const [showAllRepos, setShowAllRepos] = useState<Record<string, boolean>>({});

  const summary = useMemo(() => {
    const changedRepos = repos.filter((repo) => !repo.error && !repo.status.clean).length;
    const changedFiles = repos.reduce((count, repo) => count + repo.files.length, 0);
    return { changedRepos, changedFiles };
  }, [repos]);

  if (!panelOpen) {
    return (
      <aside className="flex h-full shrink-0 items-center" data-testid="kanban-file-changes-collapsed">
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="flex h-40 w-10 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/70 bg-white text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 shadow-sm transition hover:bg-slate-50 dark:border-[#1c1f2e] dark:bg-[#12141c] dark:text-slate-400 dark:hover:bg-[#151925]"
          aria-label="Open file changes panel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="[writing-mode:vertical-rl]">Changes</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex h-full w-[22rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white dark:border-[#1c1f2e] dark:bg-[#12141c]"
      data-testid="kanban-file-changes-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-[#191c28]">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">File Changes</div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            {repos.length} repos · {summary.changedFiles} changed files
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary.changedRepos > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {summary.changedRepos} dirty
            </span>
          )}
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-400 dark:text-slate-500">
            Loading repository changes...
          </div>
        ) : repos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-500">
            No repositories linked.
          </div>
        ) : (
          <div className="space-y-3">
            {repos.map((repo) => {
              const expanded = expandedRepos[repo.codebaseId] ?? true;
              const showAll = showAllRepos[repo.codebaseId] ?? false;
              const visibleFiles = showAll ? repo.files : repo.files.slice(0, PREVIEW_FILE_LIMIT);

              return (
                <section
                  key={repo.codebaseId}
                  className="rounded-2xl border border-slate-200/70 bg-slate-50/70 dark:border-[#202433] dark:bg-[#0d1018]"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedRepos((current) => ({ ...current, [repo.codebaseId]: !expanded }))}
                    className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {repo.label}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600 dark:bg-[#191c28] dark:text-slate-300">
                          @{repo.branch}
                        </span>
                        {repo.status.ahead > 0 && <span>{repo.status.ahead} ahead</span>}
                        {repo.status.behind > 0 && <span>{repo.status.behind} behind</span>}
                        <span>{formatChangeSummary(repo)}</span>
                      </div>
                    </div>
                    <svg
                      className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-200/70 px-3.5 py-3 dark:border-[#202433]">
                      {repo.error ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
                          {repo.error}
                        </div>
                      ) : repo.files.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-500">
                          No local changes
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {visibleFiles.map((file) => (
                            <FileRow key={`${repo.codebaseId}-${file.path}-${file.status}`} file={file} />
                          ))}
                          {repo.files.length > PREVIEW_FILE_LIMIT && (
                            <button
                              type="button"
                              onClick={() => setShowAllRepos((current) => ({ ...current, [repo.codebaseId]: !showAll }))}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-600 transition hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#12141c]"
                            >
                              {showAll ? "Show less" : `Show all ${repo.files.length} files`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
