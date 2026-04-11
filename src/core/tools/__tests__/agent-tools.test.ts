/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AgentTools } from "../agent-tools";
import { EventBus } from "../../events/event-bus";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryTaskStore } from "../../store/task-store";

describe("AgentTools.createTask", () => {
  let tools: AgentTools;
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    tools = new AgentTools(
      new InMemoryAgentStore(),
      new InMemoryConversationStore(),
      taskStore,
      new EventBus(),
    );
  });

  it("persists creationSource for session tasks", async () => {
    const result = await tools.createTask({
      title: "Session task",
      objective: "Keep task scoped to the session UI",
      workspaceId: "workspace-1",
      creationSource: "session",
    });

    expect(result.success).toBe(true);

    const taskId = (result.data as { taskId: string }).taskId;
    const task = await taskStore.get(taskId);
    expect(task?.creationSource).toBe("session");
  });
});
