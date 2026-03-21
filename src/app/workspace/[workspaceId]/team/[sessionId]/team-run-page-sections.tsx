"use client";

import type { ChatMessage } from "@/client/components/chat-panel/types";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { AskUserQuestionBubble } from "@/client/components/message-bubble";
import {
  deliverableTone,
  roleAvatarClass,
  roleChipClass,
  statusDotClass,
  TEAM_LEAD_SPECIALIST_ID,
  type DeliverableItem,
  type NormalizedTaskStatus,
  type SessionLaneSnippet,
  type SessionTimelineItem,
  type TeamMemberItem,
  type TeamMemberStatus,
  type TeamTaskNode,
} from "./team-run-page-model";

export function ObjectiveSidebarSection({
  objective,
  memberCounts,
  taskTree,
  deliverables,
  onFocusSession,
}: {
  objective: string;
  memberCounts: { done: number; active: number; blocked: number };
  taskTree: TeamTaskNode[];
  deliverables: DeliverableItem[];
  onFocusSession: (sessionId: string) => void;
}) {
  return (
    <section className="min-h-0 overflow-hidden border-r border-desktop-border bg-desktop-bg-secondary">
      <div className="border-b border-desktop-border px-4 py-2.5">
        <div className="text-[13px] font-semibold uppercase tracking-[0.2em] text-desktop-text-muted">Objective</div>
        <div className="mt-2 rounded-[18px] border border-desktop-border bg-desktop-bg-primary p-3">
          <div className="text-sm leading-5 text-desktop-text-primary">{objective}</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <MetricChip label="Done" value={memberCounts.done} tone="emerald" />
          <MetricChip label="Active" value={memberCounts.active} tone="cyan" />
          <MetricChip label="Blocked" value={memberCounts.blocked} tone="rose" />
        </div>
      </div>

      <div className="border-b border-desktop-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-desktop-text-primary">Plan / Task Tree</h2>
        <p className="mt-0.5 text-xs leading-5 text-desktop-text-secondary">Lead decomposition and current execution state.</p>
      </div>
      <div className="h-[calc(100%-176px)] overflow-y-auto px-2.5 py-2.5">
        <div className="space-y-3">
          {taskTree.length === 0 ? (
            <EmptyPanel message="No task notes yet." />
          ) : (
            <div className="space-y-1.5">
              {taskTree.map((node) => <TaskTreeNode key={node.id} node={node} />)}
            </div>
          )}

          <div className="border-t border-desktop-border pt-2.5">
            <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">
              Deliverables
            </div>
            {deliverables.length === 0 ? (
              <EmptyPanel message="No notes or deliverables yet." />
            ) : (
              <div className="divide-y divide-desktop-border rounded-[14px] border border-desktop-border bg-desktop-bg-primary">
                {deliverables.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => item.sessionId && onFocusSession(item.sessionId)}
                    disabled={!item.sessionId}
                    className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition ${
                      item.sessionId ? "hover:bg-desktop-bg-active/70" : "cursor-default"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-xs font-semibold text-desktop-text-primary">{item.label}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${deliverableTone(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-desktop-text-secondary">{item.title}</div>
                      <div className="mt-0.5 text-[10px] text-desktop-text-muted">{item.owner}</div>
                      {item.summary && (
                        <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-desktop-text-muted">{item.summary}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SessionTimelineSection({
  sessionTimeline,
  sessionLanes,
  selectedSessionId,
  onSelectSession,
  onOpenViewer,
  onSubmitQuestion,
  sessionBlockRef,
}: {
  sessionTimeline: SessionTimelineItem[];
  sessionLanes: Array<{ sessionId: string }>;
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onOpenViewer: (sessionId: string) => void;
  onSubmitQuestion?: (sessionId: string, toolCallId: string, response: Record<string, unknown>) => Promise<void>;
  sessionBlockRef: (sessionId: string, node: HTMLDivElement | null) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-desktop-bg-primary">
      <div className="border-b border-desktop-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <h2 className="text-base font-semibold text-desktop-text-primary">Session Timeline</h2>
            <p className="mt-0.5 text-xs leading-5 text-desktop-text-secondary">
              Lead decisions stay on the main line. Member sessions appear inline when delegated, then report back into the lead flow.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-desktop-text-secondary">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
              {sessionTimeline.length} events
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
              {Math.max(sessionLanes.length - 1, 0)} members
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {sessionTimeline.length === 0 ? (
          <EmptyPanel message="No lead timeline yet." />
        ) : (
          <div className="space-y-1.5">
            {sessionTimeline.map((item) => (
              <SessionTimelineCard
                key={item.id}
                item={item}
                activeSessionId={selectedSessionId}
                sessionBlockRef={item.memberLane ? (node) => sessionBlockRef(item.memberLane!.sessionId, node) : undefined}
                onSelectSession={item.memberLane ? () => onSelectSession(item.memberLane!.sessionId) : undefined}
                onOpenViewer={() => onOpenViewer(item.memberLane?.sessionId ?? item.sessionId)}
                onSubmitQuestion={onSubmitQuestion}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function TeamMembersSection({
  teamMembers,
  selectedSessionId,
  onFocusSession,
}: {
  teamMembers: TeamMemberItem[];
  selectedSessionId?: string;
  onFocusSession: (sessionId: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-hidden border-l border-desktop-border bg-desktop-bg-secondary">
      <div className="border-b border-desktop-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-desktop-text-primary">Team Members</h2>
        <p className="mt-0.5 text-xs leading-5 text-desktop-text-secondary">
          Watch who is running, who is idle, and switch to any active member session.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-desktop-border">
            {teamMembers.map((member) => {
              const isSelected = member.sessionId === selectedSessionId;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => member.sessionId && onFocusSession(member.sessionId)}
                  disabled={!member.sessionId}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition ${
                    isSelected
                      ? "bg-cyan-50/80 dark:bg-cyan-950/20"
                      : member.sessionId
                        ? "hover:bg-desktop-bg-active/70"
                        : "opacity-75"
                  }`}
                >
                  <div className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${roleAvatarClass(member.roleId)}`}>
                    {member.avatarLabel}
                    <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#141821] ${statusDotClass(member.status)}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[11px] font-semibold text-desktop-text-primary">{member.actor}</div>
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-desktop-text-secondary">{member.status}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-desktop-text-secondary">
                      {member.sessionId ? member.roleLabel : `${member.roleLabel} · no session yet`}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-desktop-text-muted">
                      <span>{member.lastUpdatedLabel ?? "Waiting for delegation"}</span>
                      {member.preview && (
                        <>
                          <span className="opacity-40">/</span>
                          <span className="truncate">{member.preview}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "cyan" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
        : "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300";
  return (
    <div className={`rounded-[16px] border px-2.5 py-2 ${toneClass}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em]">{label}</div>
    </div>
  );
}

function TaskTreeNode({
  node,
  level = 0,
}: {
  node: TeamTaskNode;
  level?: number;
}) {
  return (
    <div>
      <div
        className="rounded-[16px] border border-transparent px-2.5 py-2 transition-colors hover:border-desktop-border hover:bg-desktop-bg-active/70"
        style={{ marginLeft: level * 16 }}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <TaskStatusGlyph status={node.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className={`text-sm leading-5 ${node.status === "done" ? "text-desktop-text-muted line-through" : "text-desktop-text-primary"}`}>
                {node.title}
              </div>
              <TaskStatusPill status={node.status} />
            </div>
            {node.details && (
              <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-desktop-text-secondary">
                {node.details}
              </div>
            )}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <TaskTreeNode key={child.id} node={child} level={level + 1} />
      ))}
    </div>
  );
}

function TaskStatusGlyph({ status }: { status: NormalizedTaskStatus }) {
  if (status === "done") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    );
  }
  if (status === "in-progress") {
    return <div className="h-6 w-6 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />;
  }
  if (status === "waiting-review") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12S5.25 6.75 12 6.75 21.75 12 21.75 12 18.75 17.25 12 17.25 2.25 12 2.25 12z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </div>
    );
  }
  if (status === "blocked") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 4.5h.008v.008H12v-.008z" />
        </svg>
      </div>
    );
  }
  return <div className="h-6 w-6 rounded-full border-2 border-slate-400" />;
}

function TaskStatusPill({ status }: { status: NormalizedTaskStatus }) {
  const tone =
    status === "done"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "in-progress"
        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300"
        : status === "waiting-review"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          : status === "blocked"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] ${tone}`}>
      {status.replace("-", " ")}
    </span>
  );
}

function SessionStatusPill({ status }: { status: TeamMemberStatus }) {
  const tone =
    status === "working"
      ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300"
      : status === "reviewing"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        : status === "done"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : status === "blocked"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${tone}`}>
      {status}
    </span>
  );
}

function snippetBodyClass(snippet: SessionLaneSnippet): string {
  if (snippet.kind === "report") {
    return snippet.tone === "blocked"
      ? "border-rose-200 bg-rose-50/90 dark:border-rose-500/20 dark:bg-rose-500/10"
      : "border-emerald-200 bg-emerald-50/90 dark:border-emerald-500/20 dark:bg-emerald-500/10";
  }
  if (snippet.kind === "tool") return "border-cyan-200 bg-cyan-50/90 dark:border-cyan-500/20 dark:bg-cyan-500/10";
  if (snippet.kind === "error") return "border-rose-200 bg-rose-50/90 dark:border-rose-500/20 dark:bg-rose-500/10";
  if (snippet.kind === "user") return "border-slate-200 bg-slate-50/90 dark:border-slate-600 dark:bg-slate-800/50";
  return "border-desktop-border bg-desktop-bg-primary";
}

function SessionTimelineCard({
  item,
  activeSessionId,
  sessionBlockRef,
  onSelectSession,
  onOpenViewer,
  onSubmitQuestion,
}: {
  item: SessionTimelineItem;
  activeSessionId?: string;
  sessionBlockRef?: (node: HTMLDivElement | null) => void;
  onSelectSession?: () => void;
  onOpenViewer: () => void;
  onSubmitQuestion?: (sessionId: string, toolCallId: string, response: Record<string, unknown>) => Promise<void>;
}) {
  const lane = item.memberLane;
  const isActive = lane?.sessionId === activeSessionId;
  const pendingQuestionMessage = item.pendingQuestion ? {
    id: `${item.pendingQuestion.sessionId}-${item.pendingQuestion.toolCallId}`,
    role: "tool",
    content: "AskUserQuestion",
    timestamp: new Date(),
    toolName: "AskUserQuestion",
    toolStatus: "awaiting_input",
    toolCallId: item.pendingQuestion.toolCallId,
    toolKind: "ask-user-question",
    toolRawInput: {
      questions: item.pendingQuestion.questions,
      answers: item.pendingQuestion.answers,
    },
  } satisfies ChatMessage : null;

  const bubbleToneClass = item.actorRoleId === "user"
    ? "border-blue-100/70 bg-blue-50/60 text-blue-900 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-100"
    : item.tone === "blocked"
      ? "border-rose-200 bg-rose-50/90 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100"
      : item.tone === "complete"
        ? "border-emerald-200 bg-emerald-50/90 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100"
        : item.tone === "tool"
          ? "border-cyan-200 bg-cyan-50/90 text-cyan-900 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-100"
          : "border-gray-200/70 bg-gray-50/50 text-gray-900 dark:border-gray-800 dark:bg-[#151924] dark:text-gray-100";

  const metaLabel = item.title === "Lead update" || item.title === "Objective set"
    ? null
    : item.title;
  const wrapperClass = lane
    ? "rounded-[10px] border border-desktop-border bg-desktop-bg-secondary"
    : "py-0";
  const showMeta = item.actorRoleId !== TEAM_LEAD_SPECIALIST_ID;
  const showInlineDelegation = Boolean(lane);

  return (
    <div className={wrapperClass}>
      <div className={`flex items-start justify-between gap-2 ${lane ? "px-2 py-1" : "px-0.5 py-0"}`}>
        <div className="min-w-0">
          {showMeta ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${roleChipClass(item.actorRoleId, item.actorRoleId === TEAM_LEAD_SPECIALIST_ID ? "strong" : "soft")}`}>
                {item.actor}
              </span>
              <span className="text-[10px] text-desktop-text-muted">{item.timestamp}</span>
            </div>
          ) : null}
          {item.summary && (
            showInlineDelegation ? (
              <div className={`${showMeta ? "mt-1" : ""} flex items-center gap-1.5 text-[11px] leading-5 text-desktop-text-secondary`}>
                {metaLabel ? (
                  <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">
                    {metaLabel}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1 truncate">{item.summary}</div>
              </div>
            ) : (
              <div className={`${showMeta ? "mt-1" : ""} rounded-xl border ${showMeta ? "px-3 py-2" : "px-2 py-1"} ${bubbleToneClass}`}>
                {metaLabel && (
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">
                    {metaLabel}
                  </div>
                )}
                <MarkdownViewer content={item.summary} className={showMeta ? "text-sm leading-6" : "text-[13px] leading-[1.4]"} />
              </div>
            )
          )}
        </div>
      </div>

      {lane && (
        <div
          ref={sessionBlockRef}
          className={`mx-2 mb-2 rounded-[10px] border ${isActive ? "border-cyan-300 bg-cyan-50/50 dark:border-cyan-800 dark:bg-cyan-950/20" : "border-desktop-border bg-desktop-bg-primary"}`}
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={onSelectSession}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] transition ${roleChipClass(lane.roleId, "soft")}`}
                >
                  {lane.actor}
                </button>
                <span className="rounded-full border border-desktop-border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-desktop-text-secondary">
                  member session
                </span>
                <SessionStatusPill status={lane.status} />
                <span className="text-[10px] text-desktop-text-muted">{lane.lastUpdatedLabel}</span>
                <span className="text-[10px] text-desktop-text-muted opacity-40">/</span>
                <span className="text-[10px] text-desktop-text-muted">{lane.eventCount} updates</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenViewer}
                className="rounded-[10px] border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
              >
                Open viewer
              </button>
            </div>
          </div>

          <div className="border-t border-desktop-border/80 px-2 py-1">
            {lane.snippets.length === 0 ? (
              <div className="text-[11px] text-desktop-text-secondary">No transcript content yet.</div>
            ) : (
              <div className={`min-w-0 ${lane.snippets.at(-1)?.kind === "user" ? "flex justify-end" : ""}`}>
                <div className={`min-w-0 ${lane.snippets.at(-1)?.kind === "user" ? "max-w-[85%]" : "w-full"}`}>
                  <div className={`rounded-[10px] border px-2.5 py-1.5 ${snippetBodyClass(lane.snippets.at(-1)!)} `}>
                    <div className="line-clamp-1 text-[11px] leading-5 text-desktop-text-secondary">
                      {lane.snippets.at(-1)!.text}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {pendingQuestionMessage && onSubmitQuestion && item.pendingQuestion && (
        <div className="border-t border-desktop-border/80 px-3 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-muted">
            Awaiting input
          </div>
          <AskUserQuestionBubble
            message={pendingQuestionMessage}
            onSubmit={(toolCallId, response) => onSubmitQuestion(item.pendingQuestion!.sessionId, toolCallId, response)}
          />
        </div>
      )}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-desktop-border px-3 py-5 text-center text-sm text-desktop-text-secondary">
      {message}
    </div>
  );
}
