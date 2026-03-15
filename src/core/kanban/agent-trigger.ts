import { v4 as uuidv4 } from "uuid";
import type { Task } from "../models/task";
import { AgentEventType, type EventBus } from "../events/event-bus";
import { isClaudeCodeSdkConfigured } from "../acp/claude-code-sdk-adapter";

export function getInternalApiOrigin(): string {
  const configuredOrigin = process.env.ROUTA_INTERNAL_API_ORIGIN
    ?? process.env.ROUTA_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }

  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function buildTaskPrompt(task: Task): string {
  const labels = task.labels.length > 0 ? `Labels: ${task.labels.join(", ")}` : "Labels: none";
  const currentColumnId = task.columnId ?? "backlog";
  const isBacklogPlanning = currentColumnId === "backlog";

  // Determine the next column for move_card guidance
  const columnOrder = ["backlog", "todo", "dev", "review", "done"];
  const currentIdx = columnOrder.indexOf(currentColumnId);
  const nextColumnId = currentIdx >= 0 && currentIdx < columnOrder.length - 1
    ? columnOrder[currentIdx + 1]
    : undefined;

  const availableTools = isBacklogPlanning
    ? [
        `- **update_card**: Update this card's title, description, priority, or labels. Use cardId: "${task.id}"`,
        "- **search_cards**: Search the board for duplicates or related work before creating more tasks",
        "- **create_card**: Create exactly one follow-up backlog card if the current card must be refined into a single user story",
        "- **decompose_tasks**: Create multiple backlog cards when the current card clearly contains multiple independent stories",
        "- **create_note**: Create notes for planning or refinement context",
        `- **move_card**: Move this card to the next column when your work is complete. Use cardId: "${task.id}", targetColumnId: "${nextColumnId ?? "todo"}"`,
      ]
    : [
        `- **update_card**: Update this card's title, description, priority, or labels. Use cardId: "${task.id}"`,
        "- **create_note**: Create notes for documentation or progress tracking",
        `- **move_card**: Move this card to the next column when your work is complete. Use cardId: "${task.id}", targetColumnId: "${nextColumnId ?? "done"}"`,
      ];
  const moveInstruction = nextColumnId
    ? `When your work for this column is complete, call \`move_card\` with cardId: "${task.id}" and targetColumnId: "${nextColumnId}" to advance the card. The next column's specialist will pick it up automatically.`
    : "This card is in the final column. Update the card with your completion summary.";

  const instructions = isBacklogPlanning
    ? [
        "1. Treat backlog as planning and refinement, not implementation",
        "2. Clarify or decompose the work into backlog-ready stories when needed",
        "3. Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep in backlog planning",
        "4. Do not use GitHub CLI commands such as gh issue create",
        "5. Do not start implementation work in this column",
        "6. Report what backlog story or stories were created or refined",
        `7. ${moveInstruction}`,
      ]
    : [
        "1. Complete the work assigned to this column stage",
        "2. Use `update_card` to track progress in the card description",
        "3. Keep changes focused on this task",
        `4. ${moveInstruction}`,
        "5. Do not call `report_to_parent`; this Kanban automation session is managed directly by the workflow",
      ];

  return [
    `You are assigned to Kanban task: ${task.title}`,
    "",
    "## Context",
    "",
    "**IMPORTANT**: You are working in Kanban context. Use MCP tools (update_card, move_card, etc.) to manage this card.",
    "Do NOT create or sync GitHub issues during backlog planning.",
    "Do NOT use `gh issue create` or other GitHub CLI commands — those are for GitHub issue context only.",
    "",
    "## Task Details",
    "",
    `**Card ID:** ${task.id}`,
    `**Priority:** ${task.priority ?? "medium"}`,
    labels,
    task.githubUrl ? `**GitHub Issue:** ${task.githubUrl}` : "**GitHub Issue:** local-only",
    "",
    "## Objective",
    "",
    task.objective,
    "",
    "## Available MCP Tools",
    "",
    "You have access to the following MCP tools for task management:",
    "",
    ...availableTools,
    "",
    "## Instructions",
    "",
    ...instructions,
  ].join("\n");
}

export function resolveKanbanAutomationProvider(provider?: string): string {
  if (provider === "claude" && isClaudeCodeSdkConfigured()) {
    return "claude-code-sdk";
  }

  return provider ?? "opencode";
}

export async function triggerAssignedTaskAgent(params: {
  origin: string;
  workspaceId: string;
  cwd: string;
  branch?: string;
  task: Task;
  eventBus?: EventBus;
}): Promise<{ sessionId?: string; error?: string }> {
  const { origin, workspaceId, cwd, branch, task, eventBus } = params;
  const provider = resolveKanbanAutomationProvider(task.assignedProvider);
  const role = task.assignedRole ?? "CRAFTER";

  const newSessionResponse = await fetch(`${origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/new",
      params: {
        cwd,
        branch,
        provider,
        role,
        toolMode: "full",
        workspaceId,
        specialistId: task.assignedSpecialistId,
        name: `${task.title} · ${provider}`,
      },
    }),
  });

  const newSessionBody = await newSessionResponse.json() as { result?: { sessionId?: string }; error?: { message?: string } };
  const sessionId = newSessionBody.result?.sessionId;
  if (!newSessionResponse.ok || !sessionId) {
    return { error: newSessionBody.error?.message ?? "Failed to create ACP session." };
  }

  void (async () => {
    const response = await fetch(`${origin}/api/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: uuidv4(),
        method: "session/prompt",
        params: {
          sessionId,
          workspaceId,
          provider,
          cwd,
          prompt: [{ type: "text", text: buildTaskPrompt(task) }],
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`session/prompt HTTP ${response.status}`);
    }

    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      await response.arrayBuffer();
    }

    if (eventBus) {
      eventBus.emit({
        type: AgentEventType.AGENT_COMPLETED,
        agentId: sessionId,
        workspaceId,
        data: {
          sessionId,
          success: true,
        },
        timestamp: new Date(),
      });
    }
  })().catch((error) => {
    console.error("[kanban] Failed to auto-prompt ACP task session:", error);
    if (eventBus) {
      eventBus.emit({
        type: AgentEventType.AGENT_FAILED,
        agentId: sessionId,
        workspaceId,
        data: {
          sessionId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        timestamp: new Date(),
      });
    }
  });

  return { sessionId };
}
