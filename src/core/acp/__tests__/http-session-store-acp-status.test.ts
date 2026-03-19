/**
 * Unit tests for HttpSessionStore.updateSessionAcpStatus
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventBus, AgentEventType, type AgentEvent } from "../../events/event-bus";

// We need to test the store in isolation. Import the class and types.
// The singleton getter is module-scoped, so we test via the exported function.
import { getHttpSessionStore, consolidateMessageHistory } from "../http-session-store";
import type { SessionUpdateNotification } from "../http-session-store";

describe("HttpSessionStore — ACP status", () => {
  beforeEach(() => {
    // Clean up sessions from previous tests
    const store = getHttpSessionStore();
    for (const s of store.listSessions()) {
      store.deleteSession(s.sessionId);
    }
  });

  it("upsertSession stores acpStatus field", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-1",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    const session = store.getSession("test-1");
    expect(session).toBeDefined();
    expect(session!.acpStatus).toBe("connecting");
  });

  it("updateSessionAcpStatus transitions connecting → ready", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-2",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("test-2", "ready");

    const session = store.getSession("test-2");
    expect(session!.acpStatus).toBe("ready");
    expect(session!.acpError).toBeUndefined();
  });

  it("updateSessionAcpStatus transitions connecting → error with message", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-3",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("test-3", "error", "Process crashed");

    const session = store.getSession("test-3");
    expect(session!.acpStatus).toBe("error");
    expect(session!.acpError).toBe("Process crashed");
  });

  it("updateSessionAcpStatus pushes acp_status notification to history", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-4",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("test-4", "ready");

    const history = store.getHistory("test-4");
    expect(history.length).toBeGreaterThanOrEqual(1);

    const statusNotification = history.find(
      (n) => (n.update as Record<string, unknown>)?.sessionUpdate === "acp_status"
    );
    expect(statusNotification).toBeDefined();
    expect((statusNotification!.update as Record<string, unknown>).status).toBe("ready");
  });

  it("updateSessionAcpStatus is a no-op for unknown session", () => {
    const store = getHttpSessionStore();
    // Should not throw
    store.updateSessionAcpStatus("nonexistent", "ready");
    expect(store.getSession("nonexistent")).toBeUndefined();
  });

  it("bridges agent completion lifecycle events onto the EventBus", () => {
    const store = getHttpSessionStore();
    const eventBus = new EventBus();
    const received: AgentEvent[] = [];
    store.setEventBus(eventBus);
    eventBus.on("test-listener", (event) => {
      received.push(event);
    });

    store.upsertSession({
      sessionId: "test-complete",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });

    received.length = 0;

    store.pushNotification({
      sessionId: "test-complete",
      update: {
        sessionUpdate: "turn_complete",
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
        },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: AgentEventType.AGENT_COMPLETED,
      workspaceId: "ws-1",
      data: {
        sessionId: "test-complete",
        success: true,
        stopReason: "end_turn",
      },
    });
  });

  it("tracks session activity timestamps from normalized ACP updates", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-activity",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: "2026-03-18T00:00:00.000Z",
    });

    store.pushNotification({
      sessionId: "test-activity",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        name: "read_file",
        title: "Read file",
        status: "running",
      },
    });

    const activity = store.getSessionActivity("test-activity");
    expect(activity).toBeDefined();
    expect(activity?.lastEventType).toBe("tool_call");
    expect(activity?.lastMeaningfulActivityAt).toBeTruthy();
  });

  it("maps runtime error notifications into session acpStatus metadata", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "test-runtime-error",
      cwd: "/tmp",
      workspaceId: "ws-1",
      provider: "auggie",
      acpStatus: "ready",
      createdAt: new Date().toISOString(),
    });

    store.pushNotification({
      sessionId: "test-runtime-error",
      update: {
        sessionUpdate: "error",
        error: {
          message: "Permission denied: HTTP error: 403 Forbidden",
        },
      },
    });

    const session = store.getSession("test-runtime-error");
    expect(session?.acpStatus).toBe("error");
    expect(session?.acpError).toBe("Permission denied: HTTP error: 403 Forbidden");

    const statusNotification = store.getHistory("test-runtime-error").find(
      (entry) => (entry.update as Record<string, unknown>)?.sessionUpdate === "acp_status",
    );
    expect(statusNotification).toBeDefined();
    expect((statusNotification?.update as Record<string, unknown>)?.status).toBe("error");
  });
});

describe("consolidateMessageHistory", () => {
  it("merges consecutive agent_message_chunk into single agent_message", () => {
    const notifications: SessionUpdateNotification[] = [
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } } },
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } } },
    ];

    const result = consolidateMessageHistory(notifications);
    expect(result.length).toBe(1);
    const update = result[0].update as Record<string, unknown>;
    expect(update.sessionUpdate).toBe("agent_message");
    expect((update.content as { text: string }).text).toBe("Hello world");
  });

  it("preserves non-chunk notifications", () => {
    const notifications: SessionUpdateNotification[] = [
      { sessionId: "s1", update: { sessionUpdate: "tool_call", name: "read_file" } },
      { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } },
    ];

    const result = consolidateMessageHistory(notifications);
    expect(result.length).toBe(2);
    expect((result[0].update as Record<string, unknown>).sessionUpdate).toBe("tool_call");
    expect((result[1].update as Record<string, unknown>).sessionUpdate).toBe("agent_message");
  });
});
