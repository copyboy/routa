"use client";

/**
 * Workspace Records Hub
 *
 * Route: /workspace/[workspaceId]/overview
 *
 * This page acts as the workspace-local launcher and recovery surface.
 * It shares the same visual language as Home and hands work off into
 * session pages, with Kanban kept as the execution surface.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useTranslation } from "@/i18n";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { useNotes } from "@/client/hooks/use-notes";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { HomeInput } from "@/client/components/home-input";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { BackgroundTaskInfo, TaskInfo, SessionInfo, KanbanBoardInfo } from "@/app/workspace/[workspaceId]/types";
import { buildKanbanTaskAgentPrompt } from "@/app/workspace/[workspaceId]/kanban/i18n/kanban-task-agent";
import { Activity, Columns2, ScrollText, StickyNote } from "lucide-react";

function getSessionLabel(session: SessionInfo) {
  if (session.name) return session.name;
  if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
  if (session.provider) return session.provider;
  return `Session ${session.sessionId.slice(0, 8)}`;
}

function formatTimestamp(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}


export function WorkspacePageClient() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const workspacesHook = useWorkspaces();
  const notesHook = useNotes(workspaceId);
  const { codebases } = useCodebases(workspaceId);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);

  // Fetch sessions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch {
        if (cancelled) return;
        setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey]);

  // Fetch tasks
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setTasks([]);
        const res = await desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch {
        if (controller.signal.aborted) return;
        setTasks([]);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch boards
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setBoards([]);
        const res = await desktopAwareFetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setBoards(Array.isArray(data?.boards) ? data.boards : []);
      } catch {
        if (controller.signal.aborted) return;
        setBoards([]);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch background tasks
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await desktopAwareFetch(`/api/background-tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setBgTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch {
        if (cancelled) return;
        setBgTasks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey]);

  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId);
  const isDefaultWorkspace = workspaceId === "default";

  useEffect(() => {
    if (!workspacesHook.loading && !workspace && !isDefaultWorkspace) {
      router.push("/");
    }
  }, [workspace, workspacesHook.loading, router, isDefaultWorkspace]);

  const handleWorkspaceSelect = useCallback((wsId: string) => {
    router.push(`/workspace/${wsId}/overview`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const ws = await workspacesHook.createWorkspace(title);
    if (ws) router.push(`/workspace/${ws.id}/overview`);
  }, [workspacesHook, router]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (workspacesHook.loading && !isDefaultWorkspace) {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="text-desktop-text-secondary">{t.workspace.loadingWorkspace}</div>
      </div>
    );
  }

  if (!workspace && !isDefaultWorkspace) return null;

  const effectiveWorkspace = workspace ?? {
    id: "default",
    title: t.workspace.defaultWorkspace,
    status: "active" as const,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const pendingTasks = tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS");
  const runningBgTasks = bgTasks.filter((t) => t.status === "RUNNING").length;
  const activeBoard = boards.find((board) => board.isDefault) ?? boards[0];
  const sortedSessions = [...sessions].sort((left, right) => (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  ));
  const latestSession = sortedSessions[0] ?? null;
  const recentSessions = sortedSessions.slice(0, 6);
  const recentNotes = [...notesHook.notes]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4);
  const recentBgTasks = [...bgTasks]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 4);

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={effectiveWorkspace.title}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={effectiveWorkspace.title}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 bg-[#f6f4ef] dark:bg-[#0c1118]" data-testid="workspace-page-shell">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-8 lg:px-10 lg:py-10">
              <section className="flex flex-col gap-6">
                <div className="text-center">
                  <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {effectiveWorkspace.title}
                  </div>
                  <h1 className="mt-3 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-4xl font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-100 sm:text-5xl">
                    {t.nav.records}
                  </h1>
                  <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                    {t.workspace.recoveryRoutingContext}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Link
                      href="/"
                      className="inline-flex items-center rounded-full border border-black/8 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      {t.workspace.backToLauncher}
                    </Link>
                    <Link
                      href={`/workspace/${workspaceId}/kanban`}
                      className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
                    >
                      {t.workspace.goToBoard}
                    </Link>
                  </div>
                </div>

                <div className="rounded-3xl border border-black/6 bg-white/80 p-4 shadow-sm dark:border-white/8 dark:bg-white/5">
                  <HomeInput
                    workspaceId={workspaceId}
                    variant="default"
                    defaultAgentRole="CRAFTER"
                    buildSessionUrl={(nextWorkspaceId, sessionId) =>
                      `/workspace/${nextWorkspaceId ?? workspaceId}/sessions/${sessionId}`
                    }
                    extraSessionParams={{
                      role: "CRAFTER",
                      mcpProfile: "kanban-planning",
                      systemPrompt: (text) => buildKanbanTaskAgentPrompt({
                        workspaceId,
                        boardId: activeBoard?.id ?? "default",
                        repoPath: codebases[0]?.repoPath,
                        agentInput: text,
                        language: locale === "zh" ? "zh-CN" : "en",
                      }),
                    }}
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <Link
                    href={`/workspace/${workspaceId}/kanban`}
                    className="rounded-[24px] border border-black/6 bg-white/80 p-5 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.workspace.activeBoard}
                        </div>
                        <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {activeBoard?.name ?? t.workspace.noBoard}
                        </div>
                      </div>
                      <Columns2 className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                    </div>
                    <div className="mt-3 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
                      <div>{boards.length} {t.workspace.boards}</div>
                      <div>{pendingTasks.length} {t.workspace.activeTasks}</div>
                      <div>{runningBgTasks} {t.workspace.backgroundRuns}</div>
                    </div>
                  </Link>

                  <Link
                    href={latestSession ? `/workspace/${workspaceId}/sessions/${latestSession.sessionId}` : "/"}
                    className="rounded-[24px] border border-black/6 bg-white/80 p-5 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.workspace.latestRecoveryPoint}
                        </div>
                        <div className="mt-2 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {latestSession ? getSessionLabel(latestSession) : t.workspace.noRecentSession}
                        </div>
                      </div>
                      <ScrollText className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                    </div>
                    <div className="mt-3 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
                      <div>{sessions.length} {t.workspace.sessions}</div>
                      <div>{notesHook.notes.length} {t.workspace.notes}</div>
                      <div>{latestSession ? formatTimestamp(latestSession.createdAt) : t.workspace.createFromLauncher}</div>
                    </div>
                  </Link>

                  <div className="rounded-[24px] border border-black/6 bg-white/80 p-5 dark:border-white/8 dark:bg-white/5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.workspace.activity}
                        </div>
                        <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {bgTasks.length} {t.workspace.bgTasks}
                        </div>
                      </div>
                      <Activity className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                    </div>
                    <div className="mt-3 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
                      <div>{runningBgTasks} {t.workspace.running}</div>
                      <div>{notesHook.notes.length} {t.workspace.notes}</div>
                      <div>{t.workspace.recoverContext}</div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
                  <section className="rounded-[24px] border border-black/6 bg-white/80 p-5 dark:border-white/8 dark:bg-white/5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.workspace.recentSessions}
                        </div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          {t.workspace.recoverSession}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRefresh}
                        className="rounded-full border border-black/8 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                      >
                        {t.common.refresh}
                      </button>
                    </div>

                    {recentSessions.length > 0 ? (
                      <div className="space-y-2">
                        {recentSessions.map((session) => (
                          <Link
                            key={session.sessionId}
                            href={`/workspace/${workspaceId}/sessions/${session.sessionId}`}
                            className="flex items-center justify-between gap-4 rounded-2xl border border-black/6 bg-[#faf9f4] px-4 py-3 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {getSessionLabel(session)}
                              </div>
                              <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {session.provider ?? "unknown provider"}{session.role ? ` · ${session.role}` : ""}
                              </div>
                            </div>
                            <div className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.createdAt)}
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-black/8 bg-[#faf9f4] px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:bg-white/4 dark:text-slate-400">
                        {t.workspace.createFromLauncher}
                      </div>
                    )}
                  </section>

                  <div className="grid gap-4">
                    <section className="rounded-[24px] border border-black/6 bg-white/80 p-5 dark:border-white/8 dark:bg-white/5">
                      <div className="mb-4 flex items-center gap-2">
                        <StickyNote className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.workspace.notes}
                        </div>
                      </div>
                      {recentNotes.length > 0 ? (
                        <div className="space-y-2">
                          {recentNotes.map((note) => (
                            <div key={note.id} className="rounded-2xl border border-black/6 bg-[#faf9f4] px-4 py-3 dark:border-white/8 dark:bg-white/4">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {note.title}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                {formatTimestamp(note.updatedAt)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          {t.workspace.notesDescription}
                        </div>
                      )}
                    </section>

                    <section className="rounded-[24px] border border-black/6 bg-white/80 p-5 dark:border-white/8 dark:bg-white/5">
                      <div className="mb-4 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.workspace.activity}
                        </div>
                      </div>
                      {recentBgTasks.length > 0 ? (
                        <div className="space-y-2">
                          {recentBgTasks.map((task) => (
                            <div key={task.id} className="rounded-2xl border border-black/6 bg-[#faf9f4] px-4 py-3 dark:border-white/8 dark:bg-white/4">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {task.title}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                {task.status} · {formatTimestamp(task.createdAt)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          {t.workspace.activityDescription}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </DesktopAppShell>
  );
}
