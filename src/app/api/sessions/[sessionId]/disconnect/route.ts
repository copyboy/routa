import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import { saveHistoryToDb } from "@/core/acp/session-db-persister";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const store = getHttpSessionStore();
  const session = store.getSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    await saveHistoryToDb(sessionId, store.getConsolidatedHistory(sessionId));
  } catch (error) {
    console.error(`[SessionDisconnect] Failed to persist history for ${sessionId}:`, error);
  }

  getAcpProcessManager().killSession(sessionId);

  return NextResponse.json({ ok: true });
}