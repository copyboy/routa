"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAcp } from "@/client/hooks/use-acp";
import { useKanbanEvents } from "@/client/hooks/use-kanban-events";
import { useWorkspaces, useCodebases } from "@/client/hooks/use-workspaces";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { KanbanTab } from "./kanban-tab";
import { scheduleKanbanRefreshBurst } from "./kanban-agent-input";
import type { KanbanBoardInfo, TaskInfo, SessionInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

interface KanbanAgentPromptOptions {
  provider?: string;
  role?: string;
  toolMode?: "essential" | "full";
  allowedNativeTools?: string[];
}

export function KanbanPageClient() {
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;
  const acp = useAcp();
  const workspacesHook = useWorkspaces();
  const { codebases, fetchCodebases } = useCodebases(workspaceId);

  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshBurstCleanupRef = useRef<(() => void) | null>(null);
  const warmedupProvidersRef = useRef<Set<string>>(new Set());

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  // Fetch boards
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setBoards(Array.isArray(data?.boards) ? data.boards : []);
      } catch { /* ignore */ }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Warm up registry providers configured in column automations when the board is opened.
  useEffect(() => {
    const enabledAutomationProviderIds = new Set<string>();
    for (const board of boards) {
      for (const column of board.columns) {
        if (!column.automation?.enabled || !column.automation?.providerId) {
          continue;
        }
        enabledAutomationProviderIds.add(column.automation.providerId);
      }
    }

    if (enabledAutomationProviderIds.size === 0 || acp.providers.length === 0) return;

    const registryProviderIds = new Set(
      acp.providers
        .filter((provider) => provider.source === "registry")
        .map((provider) => provider.id),
    );

    for (const providerId of enabledAutomationProviderIds) {
      if (!registryProviderIds.has(providerId) || warmedupProvidersRef.current.has(providerId)) {
        continue;
      }

      warmedupProvidersRef.current.add(providerId);
      void fetch("/api/acp/warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: providerId }),
      }).catch(() => {
        warmedupProvidersRef.current.delete(providerId);
      });
    }
  }, [boards, acp.providers]);

  // Fetch tasks
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch { /* ignore */ }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch sessions
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" });
        const data = await res.json();
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, refreshKey]);

  // Fetch specialists
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/specialists?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        setSpecialists(Array.isArray(data?.specialists) ? data.specialists : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId]);

  const handleWorkspaceSelect = (wsId: string) => {
    router.push(`/workspace/${wsId}/kanban`);
  };

  const handleWorkspaceCreate = async (title: string) => {
    const newWs = await workspacesHook.createWorkspace(title);
    if (newWs) {
      router.push(`/workspace/${newWs.id}/kanban`);
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void fetchCodebases();
  }, [fetchCodebases]);

  const handleKanbanInvalidate = useCallback(() => {
    handleRefresh();
    refreshBurstCleanupRef.current?.();
    refreshBurstCleanupRef.current = scheduleKanbanRefreshBurst(handleRefresh);
  }, [handleRefresh]);

  useKanbanEvents({
    workspaceId,
    onInvalidate: handleKanbanInvalidate,
  });

  useEffect(() => {
    return () => {
      refreshBurstCleanupRef.current?.();
      refreshBurstCleanupRef.current = null;
    };
  }, []);

  // Handler for agent input - creates session and sends prompt
  const handleAgentPrompt = useCallback(async (
    promptText: string,
    options?: KanbanAgentPromptOptions,
  ): Promise<string | null> => {
    if (!acp.connected) {
      await acp.connect();
    }

    const defaultCodebase = codebases.find((c) => c.isDefault) ?? codebases[0];
    const cwd = defaultCodebase?.repoPath;
    const provider = options?.provider ?? acp.selectedProvider ?? undefined;

    const result = await acp.createSession(
      cwd,
      provider,
      undefined,
      options?.role ?? "DEVELOPER",
      workspaceId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options?.toolMode,
      options?.allowedNativeTools,
    );

    if (!result?.sessionId) {
      return null;
    }

    void acp.promptSession(result.sessionId, promptText).catch((error) => {
      console.error("[kanban] Failed to send Kanban agent prompt:", error);
    });

    return result.sessionId;
  }, [acp, codebases, workspaceId]);

  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId);

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title}
      workspaceSwitcher={
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
        />
      }
    >
      <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary" data-testid="kanban-page-shell">
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          <KanbanTab
            workspaceId={workspaceId}
            boards={boards}
            tasks={tasks}
            sessions={sessions}
            providers={acp.providers}
            specialists={specialists}
            codebases={codebases}
            onRefresh={handleRefresh}
            acp={acp}
            onAgentPrompt={handleAgentPrompt}
          />
        </div>
      </div>
    </DesktopAppShell>
  );
}
