import { describe, expect, it, vi } from "vitest";

import { captureSnapshot, parseCliArgs } from "../page-snapshot-lib.mjs";

describe("page-snapshot-lib", () => {
  it("parses --page in both supported CLI forms", () => {
    expect(parseCliArgs(["--page=workspace"]).page).toBe("workspace");
    expect(parseCliArgs(["--page", "kanban"]).page).toBe("kanban");
  });

  it("waits for a configured snapshot selector before taking the aria snapshot", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const ariaSnapshot = vi.fn().mockResolvedValue("- text: Snapshot");
    const locator = vi.fn().mockReturnValue({
      waitFor,
      ariaSnapshot,
    });
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      goto,
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      getByText: vi.fn(),
      waitForFunction: vi.fn(),
      title: vi.fn().mockResolvedValue("Routa"),
      url: vi.fn().mockReturnValue("http://127.0.0.1:3000/workspace/default/kanban"),
      locator,
    };

    await captureSnapshot({
      page,
      target: {
        id: "kanban",
        route: "/workspace/default/kanban",
        pageFile: "src/app/workspace/[workspaceId]/kanban/page.tsx",
        snapshotFile: "tmp/page.snapshot.yaml",
        snapshotSelector: "[data-testid=\"kanban-board-content\"]",
        waitFor: {
          strategy: "text-absent",
          value: "worktree loading...",
          timeoutMs: 1234,
          settleMs: 0,
        },
      },
      baseUrl: "http://127.0.0.1:3000",
      timeoutMs: 3000,
      outputPath: "tmp/page.snapshot.yaml",
    });

    expect(goto).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/workspace/default/kanban",
      { waitUntil: "domcontentloaded", timeout: 3000 },
    );
    expect(locator).toHaveBeenCalledWith("[data-testid=\"kanban-board-content\"]");
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1234 });
    expect(ariaSnapshot).toHaveBeenCalledOnce();
  });
});
