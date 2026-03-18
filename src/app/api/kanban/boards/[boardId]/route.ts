import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type { KanbanColumn } from "@/core/models/kanban";
import {
  getKanbanSessionConcurrencyLimit,
  setKanbanSessionConcurrencyLimit,
} from "@/core/kanban/board-session-limits";
import {
  getKanbanDevSessionSupervision,
  setKanbanDevSessionSupervision,
} from "@/core/kanban/board-session-supervision";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { getKanbanSessionQueue } from "@/core/kanban/workflow-orchestrator-singleton";
import type { KanbanDevSessionSupervision } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

interface PatchBoardBody {
  name?: string;
  columns?: KanbanColumn[];
  isDefault?: boolean;
  sessionConcurrencyLimit?: number;
  devSessionSupervision?: Partial<KanbanDevSessionSupervision>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;
  const system = getRoutaSystem();
  const board = await system.kanbanBoardStore.get(boardId);

  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  const workspace = await system.workspaceStore.get(board.workspaceId);
  const queue = getKanbanSessionQueue(system);
  return NextResponse.json({
    board: {
      ...board,
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, board.id),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, board.id),
      queue: await queue.getBoardSnapshot(board.id),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;

  let body: PatchBoardBody;
  try {
    body = await request.json() as PatchBoardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const existing = await system.kanbanBoardStore.get(boardId);

  if (!existing) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  // Update board fields
  const updated = {
    ...existing,
    name: body.name?.trim() ?? existing.name,
    columns: body.columns ?? existing.columns,
    isDefault: body.isDefault ?? existing.isDefault,
    updatedAt: new Date(),
  };

  await system.kanbanBoardStore.save(updated);

  if (body.sessionConcurrencyLimit !== undefined || body.devSessionSupervision !== undefined) {
    const workspace = await system.workspaceStore.get(existing.workspaceId);
    let nextMetadata = workspace?.metadata;
    if (body.sessionConcurrencyLimit !== undefined) {
      nextMetadata = setKanbanSessionConcurrencyLimit(
        nextMetadata,
        boardId,
        body.sessionConcurrencyLimit,
      );
    }
    if (body.devSessionSupervision !== undefined) {
      nextMetadata = setKanbanDevSessionSupervision(
        nextMetadata,
        boardId,
        body.devSessionSupervision,
      );
    }
    await system.workspaceStore.updateMetadata(existing.workspaceId, nextMetadata ?? {});
  }

  // If setting as default, update other boards
  if (body.isDefault && !existing.isDefault) {
    await system.kanbanBoardStore.setDefault(existing.workspaceId, boardId);
  }
  getKanbanEventBroadcaster().notify({
    workspaceId: existing.workspaceId,
    entity: "board",
    action: "updated",
    resourceId: boardId,
    source: "user",
  });

  const workspace = await system.workspaceStore.get(existing.workspaceId);
  const queue = getKanbanSessionQueue(system);
  return NextResponse.json({
    board: {
      ...updated,
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, boardId),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, boardId),
      queue: await queue.getBoardSnapshot(boardId),
    },
  });
}
