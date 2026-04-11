import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentTools } from "@/core/tools/agent-tools";
import { executeMcpTool, getMcpToolDefinitions } from "../mcp-tool-executor";

const {
  getSession,
  loadSessionFromDb,
  loadSessionFromLocalStorage,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadSessionFromDb: vi.fn(),
  loadSessionFromLocalStorage: vi.fn(),
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    getSession,
  }),
}));

vi.mock("@/core/acp/session-db-persister", () => ({
  loadSessionFromDb,
  loadSessionFromLocalStorage,
}));

describe("mcp-tool-executor artifact support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes artifact tools in essential mode", () => {
    const essentialNames = new Set(getMcpToolDefinitions("essential").map((tool) => tool.name));

    expect(essentialNames.has("provide_artifact")).toBe(true);
    expect(essentialNames.has("list_artifacts")).toBe(true);
    expect(essentialNames.has("capture_screenshot")).toBe(true);
    expect(essentialNames.has("request_artifact")).toBe(true);
  });

  it("routes provide_artifact execution through AgentTools", async () => {
    const provideArtifact = vi.fn().mockResolvedValue({
      success: true,
      data: {
        artifactId: "artifact-1",
        status: "provided",
      },
    });

    const result = await executeMcpTool(
      {
        provideArtifact,
      } as unknown as AgentTools,
      "provide_artifact",
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        type: "screenshot",
        taskId: "task-1",
        content: "base64-image",
        context: "Review proof",
        metadata: {
          filename: "review.png",
        },
      },
    );

    expect(provideArtifact).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      type: "screenshot",
      taskId: "task-1",
      content: "base64-image",
      context: "Review proof",
      requestId: undefined,
      metadata: {
        filename: "review.png",
      },
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      artifactId: "artifact-1",
      status: "provided",
    });
  });

  it("filters Kanban planning profile down to Kanban card tools", () => {
    const toolNames = new Set(
      getMcpToolDefinitions("full", "kanban-planning").map((tool) => tool.name),
    );

    expect(toolNames.has("create_card")).toBe(true);
    expect(toolNames.has("decompose_tasks")).toBe(true);
    expect(toolNames.has("search_cards")).toBe(true);
    expect(toolNames.has("list_cards_by_column")).toBe(true);
    expect(toolNames.has("update_task")).toBe(true);
    expect(toolNames.has("update_card")).toBe(true);
    expect(toolNames.has("move_card")).toBe(true);
    expect(toolNames.has("create_task")).toBe(false);
    expect(toolNames.has("create_note")).toBe(false);
    expect(toolNames.has("delegate_task_to_agent")).toBe(false);
  });

  it("defaults create_card assignedProvider from the calling session provider", async () => {
    getSession.mockReturnValue({ provider: "codex" });
    loadSessionFromDb.mockResolvedValue(null);
    loadSessionFromLocalStorage.mockResolvedValue(null);

    const createCard = vi.fn().mockResolvedValue({
      success: true,
      data: { cardId: "card-1" },
    });

    await executeMcpTool(
      {} as AgentTools,
      "create_card",
      {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        title: "Codex card",
      },
      undefined,
      undefined,
      { createCard } as never,
    );

    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      title: "Codex card",
      assignedProvider: "codex",
    }));
  });

  it("passes task creation source through create_task", async () => {
    const createTask = vi.fn().mockResolvedValue({
      success: true,
      data: { taskId: "task-1" },
    });

    await executeMcpTool(
      {
        createTask,
      } as unknown as AgentTools,
      "create_task",
      {
        workspaceId: "workspace-1",
        title: "Session subtask",
        objective: "Keep this local to the session",
        creationSource: "session",
      },
    );

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      title: "Session subtask",
      creationSource: "session",
    }));
  });
});
