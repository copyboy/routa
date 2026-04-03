/**
 * Sessions REST API Route - /api/sessions
 *
 * Lists ACP sessions created via /api/acp for the browser UI.
 * This is NOT part of ACP; it's only for the web dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const store = getHttpSessionStore();

  // Hydrate from database on first access (loads persisted sessions)
  await store.hydrateFromDb();

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const parentSessionId = request.nextUrl.searchParams.get("parentSessionId");
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : Number.NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  let sessions = store.listSessions();
  if (workspaceId) {
    sessions = sessions.filter((s) => s.workspaceId === workspaceId);
  }

  // Filter by parent session ID — used to restore CRAFTER state on page reload
  if (parentSessionId) {
    sessions = sessions.filter((s) => s.parentSessionId === parentSessionId);
    // When querying children, include sessions that haven't sent a prompt yet
    return NextResponse.json(
      { sessions: limit ? sessions.slice(0, limit) : sessions },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Filter out empty sessions that never received a real prompt
  sessions = sessions.filter((s) => s.firstPromptSent !== false);

  return NextResponse.json(
    { sessions: limit ? sessions.slice(0, limit) : sessions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
