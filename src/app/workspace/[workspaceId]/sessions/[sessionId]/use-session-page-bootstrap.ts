"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { consumePendingPrompt } from "@/client/utils/pending-prompt";

export type AgentRole = "CRAFTER" | "ROUTA" | "GATE" | "DEVELOPER";

export interface SpecialistOption {
  id: string;
  name: string;
  role: AgentRole;
  defaultProvider?: string;
  model?: string;
}

interface SessionRecord {
  sessionId: string;
  name?: string;
  provider?: string;
  role?: string;
  parentSessionId?: string;
}

interface UseSessionPageBootstrapParams {
  showSpecialistManager: boolean;
  sessionId: string;
  displaySessionId: string;
  isResolved: boolean;
  acpConnected: boolean;
  acpLoading: boolean;
  acpSessionId: string | null;
  acpUpdates: Array<Record<string, unknown>>;
  acpSelectedProvider: string;
  acpConnect: () => Promise<void>;
  acpSelectSession: (sessionId: string) => void;
  acpSetProvider: (provider: string) => void;
  acpPrompt: (text: string) => Promise<void>;
  setSelectedAgent: (role: AgentRole) => void;
  setDockerErrorMessage: (message: string | null) => void;
  setDockerRetryText: (text: string | null) => void;
}

export function useSessionPageBootstrap(params: UseSessionPageBootstrapParams) {
  const {
    showSpecialistManager,
    sessionId,
    displaySessionId,
    isResolved,
    acpConnected,
    acpLoading,
    acpSessionId,
    acpUpdates,
    acpSelectedProvider,
    acpConnect,
    acpSelectSession,
    acpSetProvider,
    acpPrompt,
    setSelectedAgent,
    setDockerErrorMessage,
    setDockerRetryText,
  } = params;

  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [toolMode, setToolMode] = useState<"essential" | "full">("essential");
  const sessionMetadataLoadedRef = useRef<Set<string>>(new Set());
  const pendingPromptSentRef = useRef<Set<string>>(new Set());
  const pendingPromptTextRef = useRef<string | null>(null);

  useEffect(() => {
    const loadSpecialists = async () => {
      try {
        const res = await fetch("/api/specialists");
        if (!res.ok) return;
        const data = await res.json();
        const items: SpecialistOption[] = (data.specialists || [])
          .filter((s: any) => s.enabled !== false)
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            role: s.role as AgentRole,
            defaultProvider: s.defaultProvider,
            model: s.model,
          }));
        setSpecialists(items);
      } catch {
        // Specialists are optional — DB may not have the table yet
      }
    };
    void loadSpecialists();
  }, [showSpecialistManager]);

  useEffect(() => {
    if (!acpConnected && !acpLoading) {
      void acpConnect();
    }
  }, [acpConnected, acpLoading, acpConnect]);

  useEffect(() => {
    if (!isResolved || displaySessionId === "__placeholder__") return;
    if (displaySessionId && acpConnected && displaySessionId !== acpSessionId) {
      acpSelectSession(displaySessionId);
    }
  }, [displaySessionId, isResolved, acpConnected, acpSessionId, acpSelectSession]);

  useEffect(() => {
    if (!isResolved || displaySessionId === "__placeholder__") return;
    if (!displaySessionId || !acpConnected) return;
    if (sessionMetadataLoadedRef.current.has(displaySessionId)) return;
    sessionMetadataLoadedRef.current.add(displaySessionId);

    fetch(`/api/sessions/${displaySessionId}`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!data?.session) return;
        const { role, provider } = data.session as SessionRecord;
        if (role && ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"].includes(role)) {
          setSelectedAgent(role as AgentRole);
        }
        if (provider) {
          acpSetProvider(provider);
        }
        console.log(`[SessionPage] Restored session metadata: role=${role}, provider=${provider}`);
      })
      .catch((err) => {
        console.warn("[SessionPage] Failed to restore session metadata:", err);
      });
  }, [displaySessionId, isResolved, acpConnected, acpSetProvider, setSelectedAgent]);

  useEffect(() => {
    if (!sessionId || !acpConnected || acpLoading) return;
    if (pendingPromptSentRef.current.has(sessionId)) return;

    if (!pendingPromptTextRef.current) {
      const text = consumePendingPrompt(sessionId);
      if (!text) return;
      pendingPromptTextRef.current = text;
    }

    const pendingText = pendingPromptTextRef.current;
    const lastUpdate = acpUpdates.findLast(
      (u) => (u as Record<string, unknown>).update &&
        ((u as Record<string, unknown>).update as Record<string, unknown>).sessionUpdate === "acp_status"
    );
    const acpReady = lastUpdate &&
      ((lastUpdate as Record<string, unknown>).update as Record<string, unknown>).status === "ready";

    if (acpReady) {
      console.log(`[SessionPage] ACP ready, sending pending prompt for session ${sessionId}`);
      pendingPromptSentRef.current.add(sessionId);
      pendingPromptTextRef.current = null;
      void acpPrompt(pendingText);
      return;
    }

    console.log(`[SessionPage] Waiting for ACP ready before sending pending prompt for session ${sessionId}`);

    const timer = setTimeout(() => {
      if (!pendingPromptSentRef.current.has(sessionId) && pendingPromptTextRef.current) {
        console.log(`[SessionPage] Timeout fallback: sending pending prompt for session ${sessionId}`);
        pendingPromptSentRef.current.add(sessionId);
        pendingPromptTextRef.current = null;
        void acpPrompt(pendingText);
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [sessionId, acpConnected, acpLoading, acpUpdates, acpPrompt]);

  useEffect(() => {
    if (!acpUpdates.length) return;
    const lastUpdate = acpUpdates[acpUpdates.length - 1];
    const update = (lastUpdate as Record<string, unknown>).update as Record<string, unknown> | undefined;
    if (
      update?.sessionUpdate === "acp_status" &&
      update?.status === "error" &&
      acpSelectedProvider === "docker-opencode"
    ) {
      const errMsg = (update.error as string | undefined) ?? "Docker session failed to start";
      setDockerErrorMessage(errMsg);
      if (pendingPromptTextRef.current) {
        setDockerRetryText(pendingPromptTextRef.current);
        pendingPromptTextRef.current = null;
      }
    }
  }, [acpUpdates, acpSelectedProvider, setDockerErrorMessage, setDockerRetryText]);

  useEffect(() => {
    fetch("/api/mcp/tools")
      .then((res) => res.json())
      .then((data) => {
        if (data?.globalMode) {
          setToolMode(data.globalMode);
        }
      })
      .catch(() => {});
  }, []);

  const handleToolModeToggle = useCallback(async (checked: boolean) => {
    const newMode = checked ? "essential" : "full";
    setToolMode(newMode);
    try {
      await fetch("/api/mcp/tools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (error) {
      console.error("Failed to toggle tool mode:", error);
    }
  }, []);

  return {
    specialists,
    toolMode,
    handleToolModeToggle,
  };
}
