"use client";

import { useRef, useState } from "react";
import type { KanbanCommitChangeItem, KanbanCommitDiffPreview, KanbanFileChangeItem, KanbanFileDiffPreview } from "./kanban-file-changes-types";
import { splitFilePath, STATUS_BADGE } from "./kanban-file-changes-panel";
import { useTranslation } from "@/i18n";

export interface ParsedDiffPreview {
  additions: number;
  deletions: number;
  lines: Array<{
    kind: "meta" | "hunk" | "add" | "remove" | "context";
    text: string;
    oldLineNumber?: number;
    newLineNumber?: number;
  }>;
}

export interface CommitDiffFile {
  path: string;
  previousPath?: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  startLineIndex: number; // Line index in the patch where this file's diff starts
}

/**
 * Parse commit diff to extract list of changed files with their stats.
 * Parses unified diff format to find file headers and count additions/deletions per file.
 */
export function parseCommitDiffFiles(patch: string): CommitDiffFile[] {
  const lines = patch.split("\n");
  const files: CommitDiffFile[] = [];
  let currentFile: Partial<CommitDiffFile> | null = null;
  let currentFileAdditions = 0;
  let currentFileDeletions = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file starts with "diff --git a/... b/..."
    if (line.startsWith("diff --git ")) {
      // Save previous file if exists
      if (currentFile) {
        files.push({
          ...currentFile,
          additions: currentFileAdditions,
          deletions: currentFileDeletions,
        } as CommitDiffFile);
      }

      // Parse paths from "diff --git a/path1 b/path2"
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        const previousPath = match[1];
        const path = match[2];
        currentFile = {
          path,
          previousPath: previousPath !== path ? previousPath : undefined,
          status: "modified", // Default, will be refined below
          startLineIndex: i,
        };
        currentFileAdditions = 0;
        currentFileDeletions = 0;
      }
      continue;
    }

    // Detect file status from metadata lines
    if (currentFile) {
      if (line.startsWith("new file mode ")) {
        currentFile.status = "added";
      } else if (line.startsWith("deleted file mode ")) {
        currentFile.status = "deleted";
      } else if (line.startsWith("rename from ")) {
        currentFile.status = "renamed";
      }
    }

    // Count additions and deletions for current file
    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      currentFileAdditions += 1;
    } else if (currentFile && line.startsWith("-") && !line.startsWith("---")) {
      currentFileDeletions += 1;
    }
  }

  // Save last file
  if (currentFile) {
    files.push({
      ...currentFile,
      additions: currentFileAdditions,
      deletions: currentFileDeletions,
    } as CommitDiffFile);
  }

  return files;
}

export function parseUnifiedDiffPreview(diff: { patch: string; additions?: number; deletions?: number }): ParsedDiffPreview {
  const lines = diff.patch.split("\n");
  let additions = diff.additions ?? 0;
  let deletions = diff.deletions ?? 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let countedBodyLines = false;

  const parsedLines = lines.map((line) => {
    if (line.startsWith("+++ b/")) return { kind: "meta" as const, text: line };
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (diff.additions == null) additions += 1;
      countedBodyLines = true;
      const parsedLine = { kind: "add" as const, text: line, newLineNumber };
      newLineNumber += 1;
      return parsedLine;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (diff.deletions == null) deletions += 1;
      countedBodyLines = true;
      const parsedLine = { kind: "remove" as const, text: line, oldLineNumber };
      oldLineNumber += 1;
      return parsedLine;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLineNumber = Number.parseInt(match[1] ?? "0", 10);
        newLineNumber = Number.parseInt(match[2] ?? "0", 10);
      }
      return { kind: "hunk" as const, text: line };
    }
    if (
      line.startsWith("diff --git ")
      || line.startsWith("index ")
      || line.startsWith("--- ")
      || line.startsWith("new file mode ")
      || line.startsWith("deleted file mode ")
      || line.startsWith("similarity index ")
      || line.startsWith("rename from ")
      || line.startsWith("rename to ")
    ) {
      return { kind: "meta" as const, text: line };
    }
    if (line.startsWith(" ")) {
      countedBodyLines = true;
      const parsedLine = { kind: "context" as const, text: line, oldLineNumber, newLineNumber };
      oldLineNumber += 1;
      newLineNumber += 1;
      return parsedLine;
    }
    return { kind: "context" as const, text: line };
  });

  return {
    additions: countedBodyLines ? additions : diff.additions ?? additions,
    deletions: countedBodyLines ? deletions : diff.deletions ?? deletions,
    lines: parsedLines,
  };
}

export function renderUnifiedDiffLines(parsedDiff: ParsedDiffPreview) {
  return parsedDiff.lines.map((line, index) => (
    <div
      key={`${line.text}-${index}`}
      className={
        line.kind === "add"
          ? "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] bg-emerald-950/70 px-3 text-emerald-100"
          : line.kind === "remove"
            ? "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] bg-rose-950/60 px-3 text-rose-100"
            : line.kind === "hunk"
              ? "bg-sky-950/60 px-3 text-sky-100"
              : line.kind === "meta"
                ? "bg-slate-900 px-3 text-slate-400"
                : "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] px-3 text-slate-200"
      }
    >
      {line.kind === "add" || line.kind === "remove" || line.kind === "context" ? (
        <>
          <span className="select-none pr-2 text-right text-slate-500">
            {typeof line.oldLineNumber === "number" ? (
              <span data-testid={`kanban-diff-old-line-${index}`}>{line.oldLineNumber}</span>
            ) : ""}
          </span>
          <span className="select-none pr-2 text-right text-slate-500">
            {typeof line.newLineNumber === "number" ? (
              <span data-testid={`kanban-diff-new-line-${index}`}>{line.newLineNumber}</span>
            ) : ""}
          </span>
          <span className="select-none text-center">
            {line.text[0] ?? " "}
          </span>
          <span>{line.text.slice(1) || " "}</span>
        </>
      ) : (
        line.text || " "
      )}
    </div>
  ));
}

export function TaskFileDiffPreview({
  file,
  diff,
  loading,
  error,
  compact = false,
}: {
  file: KanbanFileChangeItem | null;
  diff?: KanbanFileDiffPreview;
  loading: boolean;
  error?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (!file) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.clickFileToInspectDiff}
      </div>
    );
  }

  const badge = STATUS_BADGE[file.status];
  const parsedDiff = diff ? parseUnifiedDiffPreview(diff) : null;
  const previewPath = diff?.path ?? file.path;
  const lastSlash = previewPath.lastIndexOf("/");
  const fileName = lastSlash === -1 ? previewPath : previewPath.slice(lastSlash + 1);
  const fileDirectory = lastSlash === -1 ? null : previewPath.slice(0, lastSlash);
  const additions = parsedDiff?.additions ?? diff?.additions ?? file.additions ?? 0;
  const deletions = parsedDiff?.deletions ?? diff?.deletions ?? file.deletions ?? 0;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#202433] dark:bg-[#0d1018]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-[#202433]">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${badge.className}`}>
            {badge.short}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={fileName}>
              {fileName}
            </div>
            {fileDirectory && (
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={fileDirectory}>
                {fileDirectory}
              </div>
            )}
          </div>
          {file.previousPath && (
            <>
              <span />
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={file.previousPath}>
                {t.kanban.fromPath} {file.previousPath}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 text-[11px] font-mono">
          <span className="text-emerald-600 dark:text-emerald-300">+{additions}</span>
          {" "}
          <span className="text-rose-600 dark:text-rose-300">-{deletions}</span>
        </div>
      </div>

      {loading ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.loadingFileDiff}
        </div>
      ) : error ? (
        <div className={`border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {error}
        </div>
      ) : !diff?.patch.trim() || !parsedDiff ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.noDiffAvailable}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
            {renderUnifiedDiffLines(parsedDiff)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function CommitRow({
  commit,
  selected = false,
  onClick,
}: {
  commit: KanbanCommitChangeItem;
  selected?: boolean;
  onClick?: () => void;
}) {
  const timestamp = new Date(commit.authoredAt);
  const renderedTimestamp = Number.isNaN(timestamp.getTime()) ? commit.authoredAt : timestamp.toLocaleString();
  return (
    <button
      type="button"
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-amber-50/80 dark:bg-amber-900/10" : "hover:bg-slate-100/80 dark:hover:bg-[#171b27]"
      }`}
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`kanban-commit-row-${commit.sha}`}
    >
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium leading-4 text-slate-800 dark:text-slate-100" title={commit.summary}>
          {commit.summary}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[9px] leading-3.5 text-slate-500 dark:text-slate-400">
          <span className="rounded-sm border border-slate-200 px-1 py-0 dark:border-slate-700">{commit.shortSha}</span>
          <span>{commit.authorName}</span>
          <span>{renderedTimestamp}</span>
        </div>
      </div>
      <div className="mt-0.5 flex min-w-[3.25rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
        <span className="text-emerald-600 dark:text-emerald-300">+{commit.additions}</span>
        <span className="text-rose-600 dark:text-rose-300">-{commit.deletions}</span>
      </div>
    </button>
  );
}

export function CommitFileList({
  files,
  expanded,
  onToggle,
  onFileClick,
  activeFilePath,
}: {
  files: CommitDiffFile[];
  expanded: boolean;
  onToggle: () => void;
  onFileClick: (file: CommitDiffFile) => void;
  activeFilePath: string | null;
}) {
  const { t } = useTranslation();
  const statusBadges = {
    modified: { icon: "M", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
    added: { icon: "A", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
    deleted: { icon: "D", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" },
    renamed: { icon: "R", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" },
  };

  return (
    <div className="border-b border-slate-200/70 dark:border-[#202433]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-[#171b27]"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t.kanbanDetail.filesChanged} ({files.length})
        </span>
        <svg
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="max-h-[16rem] space-y-0.5 overflow-y-auto px-2 pb-2">
          {files.map((file) => {
            const badge = statusBadges[file.status];
            const active = file.path === activeFilePath;
            const { name, directory } = splitFilePath(file.path);

            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onFileClick(file)}
                className={`grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  active
                    ? "bg-amber-50/80 dark:bg-amber-900/10"
                    : "hover:bg-slate-100/80 dark:hover:bg-[#171b27]"
                }`}
              >
                <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${badge.className}`}>
                  {badge.icon}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100" title={file.path}>
                    {name}
                  </div>
                  {directory && (
                    <div className="truncate text-[10px] text-slate-500 dark:text-slate-400" title={directory}>
                      {directory}
                    </div>
                  )}
                  {file.previousPath && file.status === "renamed" && (
                    <div className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500" title={file.previousPath}>
                      {splitFilePath(file.previousPath).name}
                    </div>
                  )}
                </div>
                <div className="flex min-w-[3.5rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
                  <span className="text-emerald-600 dark:text-emerald-300">+{file.additions}</span>
                  <span className="text-rose-600 dark:text-rose-300">-{file.deletions}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TaskCommitDiffPreview({
  commit,
  diff,
  loading,
  error,
  compact = false,
}: {
  commit: KanbanCommitChangeItem | null;
  diff?: KanbanCommitDiffPreview;
  loading: boolean;
  error?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const diffViewerRef = useRef<HTMLDivElement>(null);

  // Calculate file list and diff preview from commit
  const preview = commit ? (diff ?? { ...commit, patch: "" }) : null;
  const parsedDiff = preview?.patch ? parseUnifiedDiffPreview(preview) : null;
  const fileList = preview?.patch ? parseCommitDiffFiles(preview.patch) : [];

  // Auto-collapse file list if more than 10 files
  // Default to expanded for small commits, collapsed for large ones
  const shouldAutoExpand = fileList.length <= 10;
  const [isExpanded, setIsExpanded] = useState(() => shouldAutoExpand);

  if (!commit) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.clickCommitToInspectDiff}
      </div>
    );
  }

  const handleFileClick = (file: CommitDiffFile) => {
    setActiveFilePath(file.path);

    // Scroll to the file's diff section
    if (diffViewerRef.current && parsedDiff) {
      const targetLine = parsedDiff.lines[file.startLineIndex];
      if (targetLine) {
        // Find the DOM element for this line and scroll to it
        const lineElement = diffViewerRef.current.querySelector(`[data-line-index="${file.startLineIndex}"]`);
        if (lineElement) {
          lineElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }
  };

  // TypeScript guard: preview is guaranteed to be non-null here due to commit check above
  if (!preview) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#202433] dark:bg-[#0d1018]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-[#202433]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={preview.summary}>
            {preview.summary}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">{preview.shortSha}</span>
            <span>{preview.authorName}</span>
            <span>{new Date(preview.authoredAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="shrink-0 text-[11px] font-mono">
          <span className="text-emerald-600 dark:text-emerald-300">+{preview.additions}</span>
          {" "}
          <span className="text-rose-600 dark:text-rose-300">-{preview.deletions}</span>
        </div>
      </div>

      {fileList.length > 0 && (
        <CommitFileList
          files={fileList}
          expanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
          onFileClick={handleFileClick}
          activeFilePath={activeFilePath}
        />
      )}

      {loading ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.loadingCommitDiff}
        </div>
      ) : error ? (
        <div className={`border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {error}
        </div>
      ) : !parsedDiff ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.noDiffAvailable}
        </div>
      ) : (
        <div ref={diffViewerRef} className="max-h-[28rem] overflow-auto">
          <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
            {renderUnifiedDiffLines(parsedDiff)}
          </pre>
        </div>
      )}
    </div>
  );
}
