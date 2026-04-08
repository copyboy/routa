"use client";

import React from "react";
import { X } from "lucide-react";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanInlineDiffViewerProps {
  file: KanbanFileChangeItem | null;
  diff?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  commitSha?: string;
}

export function KanbanInlineDiffViewer({
  file,
  diff,
  loading = false,
  error,
  onClose,
  commitSha,
}: KanbanInlineDiffViewerProps) {
  if (!file) return null;

  const parseDiff = (diffText: string) => {
    const lines = diffText.split("\n");
    const chunks: { type: "add" | "remove" | "context" | "header"; content: string; lineNum?: string }[] = [];

    for (const line of lines) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
        chunks.push({ type: "header", content: line });
      } else if (line.startsWith("+")) {
        chunks.push({ type: "add", content: line.substring(1) });
      } else if (line.startsWith("-")) {
        chunks.push({ type: "remove", content: line.substring(1) });
      } else if (line.startsWith(" ")) {
        chunks.push({ type: "context", content: line.substring(1) });
      } else {
        chunks.push({ type: "context", content: line });
      }
    }

    return chunks;
  };

  const chunks = diff ? parseDiff(diff) : [];

  return (
    <div className="rounded-lg border border-slate-200/70 bg-white dark:border-slate-700 dark:bg-[#12141c]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-3 py-2 dark:border-slate-700">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
            {file.path}
          </div>
          {commitSha && (
            <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              Commit: {commitSha.substring(0, 7)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-slate-400 dark:text-slate-500">
            Loading diff...
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        ) : !diff ? (
          <div className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500">
            No diff available
          </div>
        ) : (
          <div className="font-mono text-[10px]">
            {chunks.map((chunk, i) => {
              const getStyles = () => {
                const prefix = chunk.type === "add" ? "+" : chunk.type === "remove" ? "-" : " ";

                if (chunk.type === "add") {
                  return {
                    bgClass: "bg-emerald-50 dark:bg-emerald-900/20",
                    textClass: "text-emerald-900 dark:text-emerald-300",
                    prefix,
                  };
                }
                if (chunk.type === "remove") {
                  return {
                    bgClass: "bg-rose-50 dark:bg-rose-900/20",
                    textClass: "text-rose-900 dark:text-rose-300",
                    prefix,
                  };
                }
                if (chunk.type === "header") {
                  return {
                    bgClass: "bg-sky-50 dark:bg-sky-900/20",
                    textClass: "text-sky-900 dark:text-sky-300",
                    prefix: "",
                  };
                }
                return {
                  bgClass: "",
                  textClass: "text-slate-600 dark:text-slate-400",
                  prefix,
                };
              };

              const { bgClass, textClass, prefix } = getStyles();

              return (
                <div
                  key={i}
                  className={`px-3 py-0.5 ${bgClass} ${textClass}`}
                >
                  <span className="inline-block w-3 select-none opacity-50">
                    {prefix}
                  </span>
                  <span className="whitespace-pre">{chunk.content}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
