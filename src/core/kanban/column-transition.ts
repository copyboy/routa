/**
 * Column Transition — Event types and handler for Kanban column transitions.
 *
 * When a card moves between columns, a COLUMN_TRANSITION event is emitted.
 * The ColumnTransitionHandler listens for these events and triggers
 * the appropriate Column Agent based on KanbanColumnAutomation config.
 */

import { EventBus, AgentEventType, AgentEvent } from "../events/event-bus";
import type { KanbanColumnAutomation } from "../models/kanban";
import type { KanbanBoardStore } from "../store/kanban-board-store";

/** Data payload for COLUMN_TRANSITION events */
export interface ColumnTransitionData {
  cardId: string;
  cardTitle: string;
  boardId: string;
  workspaceId: string;
  fromColumnId: string;
  toColumnId: string;
  fromColumnName?: string;
  toColumnName?: string;
}

/**
 * Emit a COLUMN_TRANSITION event on the event bus.
 */
export function emitColumnTransition(
  eventBus: EventBus,
  data: ColumnTransitionData,
): void {
  const event: AgentEvent = {
    type: AgentEventType.COLUMN_TRANSITION,
    agentId: "kanban-system",
    workspaceId: data.workspaceId,
    data: data as unknown as Record<string, unknown>,
    timestamp: new Date(),
  };
  eventBus.emit(event);
}

/** Callback invoked when a column transition should trigger an agent */
export type TransitionTriggerCallback = (params: {
  workspaceId: string;
  boardId: string;
  cardId: string;
  cardTitle: string;
  columnId: string;
  columnName: string;
  automation: KanbanColumnAutomation;
}) => Promise<void>;

/**
 * ColumnTransitionHandler — Listens for COLUMN_TRANSITION events and
 * triggers the configured Column Agent for the target column.
 */
export class ColumnTransitionHandler {
  private handlerKey = "kanban-column-transition-handler";

  constructor(
    private eventBus: EventBus,
    private kanbanBoardStore: KanbanBoardStore,
    private onTrigger: TransitionTriggerCallback,
  ) {}

  /** Start listening for column transition events */
  start(): void {
    this.eventBus.on(this.handlerKey, (event: AgentEvent) => {
      if (event.type !== AgentEventType.COLUMN_TRANSITION) return;
      void this.handleTransition(event);
    });
  }

  /** Stop listening */
  stop(): void {
    this.eventBus.off(this.handlerKey);
  }

  private async handleTransition(event: AgentEvent): Promise<void> {
    const data = event.data as unknown as ColumnTransitionData;
    const board = await this.kanbanBoardStore.get(data.boardId);
    if (!board) return;

    const targetColumn = board.columns.find((c) => c.id === data.toColumnId);
    if (!targetColumn?.automation?.enabled) return;

    const automation = targetColumn.automation;
    const transitionType = automation.transitionType ?? "entry";

    // Only trigger on entry or both
    if (transitionType !== "entry" && transitionType !== "both") return;

    try {
      await this.onTrigger({
        workspaceId: data.workspaceId,
        boardId: data.boardId,
        cardId: data.cardId,
        cardTitle: data.cardTitle,
        columnId: targetColumn.id,
        columnName: targetColumn.name,
        automation,
      });
    } catch (err) {
      console.error("[ColumnTransitionHandler] Failed to trigger agent:", err);
    }
  }
}
