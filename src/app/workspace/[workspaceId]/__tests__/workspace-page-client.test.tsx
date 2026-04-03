import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  desktopAwareFetch,
  pushMock,
  connectMock,
  updateNoteMock,
} = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  pushMock: vi.fn(),
  connectMock: vi.fn(),
  updateNoteMock: vi.fn(),
}));

const globalFetchSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ workspaceId: "default" }),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      workspace: {
        loadingWorkspace: "Loading workspace",
        defaultWorkspace: "Default Workspace",
        activeBoard: "Active board",
        noBoard: "No board",
        goToBoard: "Go to board",
        boards: "boards",
        activeTasks: "active tasks",
        backgroundRuns: "background runs",
        latestRecoveryPoint: "Latest recovery point",
        noRecentSession: "No recent session",
        recoverSession: "Recover session",
        createFromLauncher: "Create from launcher",
        sessions: "Sessions",
        notes: "Notes",
        agents: "Agents",
        recentSessions: "Recent sessions",
        workspaceNotes: "Workspace notes",
        taskNotes: "Task notes",
        workspaces: "Workspaces",
        tasks: "Tasks",
        bgTasks: "Background tasks",
        active: "active",
        pending: "pending",
        running: "running",
        overview: "Overview",
        activity: "Activity",
        activityDescription: "Activity description",
        notesDescription: "Notes description",
        installAgents: "Install agents",
      },
    },
  }),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "default", title: "Default Workspace", status: "active" }],
    loading: false,
    createWorkspace: vi.fn(),
  }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    connect: connectMock,
  }),
}));

vi.mock("@/client/hooks/use-agents-rpc", () => ({
  useAgentsRpc: () => ({
    agents: [],
    loading: false,
  }),
}));

vi.mock("@/client/hooks/use-notes", () => ({
  useNotes: () => ({
    notes: [],
    loading: false,
    updateNote: updateNoteMock,
  }),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceSwitcher, titleBarRight }: { children: ReactNode; workspaceSwitcher?: ReactNode; titleBarRight?: ReactNode }) => (
    <div data-testid="desktop-shell">
      {workspaceSwitcher}
      {titleBarRight}
      {children}
    </div>
  ),
}));

vi.mock("@/client/components/agent-install-panel", () => ({
  AgentInstallPanel: () => <div data-testid="agent-install-panel" />,
}));

vi.mock("@/client/components/compact-stat", () => ({
  CompactStat: ({ label, value }: { label: string; value: number }) => <div>{label}:{value}</div>,
}));

vi.mock("@/client/components/workspace-tab-bar", () => ({
  WorkspaceTabBar: () => <div data-testid="workspace-tab-bar" />,
}));

vi.mock("@/client/components/workspace-page-header", () => ({
  WorkspacePageHeader: () => <div data-testid="workspace-page-header" />,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/app/workspace/[workspaceId]/note-tasks-tab", () => ({
  NoteTasksTab: () => <div data-testid="note-tasks-tab" />,
}));

vi.mock("@/app/workspace/[workspaceId]/notes-tab", () => ({
  NotesTab: () => <div data-testid="notes-tab" />,
}));

vi.mock("@/app/workspace/[workspaceId]/bg-tasks-tab", () => ({
  BgTasksTab: () => <div data-testid="bg-tasks-tab" />,
}));

import { WorkspacePageClient } from "../workspace-page-client";

describe("WorkspacePageClient", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url === "/api/sessions?workspaceId=default&limit=100") {
        return {
          ok: true,
          json: async () => ({ sessions: [] }),
        };
      }
      if (url === "/api/tasks?workspaceId=default") {
        return {
          ok: true,
          json: async () => ({ tasks: [] }),
        };
      }
      if (url === "/api/kanban/boards?workspaceId=default") {
        return {
          ok: true,
          json: async () => ({ boards: [] }),
        };
      }
      if (url === "/api/background-tasks?workspaceId=default") {
        return {
          ok: true,
          json: async () => ({ tasks: [] }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    globalFetchSpy.mockReset();
    vi.stubGlobal("fetch", globalFetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads overview data via desktopAwareFetch instead of raw fetch", async () => {
    render(<WorkspacePageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("desktop-shell")).not.toBeNull();
      expect(desktopAwareFetch).toHaveBeenCalledTimes(4);
    });

    const requestedUrls = desktopAwareFetch.mock.calls.map(([url]) => url);
    expect(requestedUrls).toContain("/api/sessions?workspaceId=default&limit=100");
    expect(requestedUrls).toContain("/api/tasks?workspaceId=default");
    expect(requestedUrls).toContain("/api/kanban/boards?workspaceId=default");
    expect(requestedUrls).toContain("/api/background-tasks?workspaceId=default");
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});
