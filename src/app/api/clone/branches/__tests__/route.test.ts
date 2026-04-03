import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSync } = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
}));

const gitMocks = vi.hoisted(() => ({
  getCurrentBranch: vi.fn(),
  listBranches: vi.fn(),
  listRemoteBranches: vi.fn(),
  fetchRemote: vi.fn(),
  getBranchStatus: vi.fn(),
  checkoutBranch: vi.fn(),
  deleteBranch: vi.fn(),
  pullBranch: vi.fn(),
  getBranchInfo: vi.fn(),
  getRepoStatus: vi.fn(),
  resetLocalChanges: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync,
}));

vi.mock("@/core/git", () => gitMocks);

import { DELETE } from "../route";

describe("/api/clone/branches DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    gitMocks.deleteBranch.mockReturnValue({ success: true });
    gitMocks.getBranchInfo.mockReturnValue({
      current: "main",
      branches: ["main", "feature/polish"],
    });
  });

  it("deletes a local branch and returns refreshed branch info", async () => {
    const request = new NextRequest("http://localhost/api/clone/branches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: "/tmp/repos/demo",
        branch: "issue/task-1",
      }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(gitMocks.deleteBranch).toHaveBeenCalledWith("/tmp/repos/demo", "issue/task-1");
    expect(data).toEqual({
      success: true,
      deletedBranch: "issue/task-1",
      current: "main",
      branches: ["main", "feature/polish"],
    });
  });

  it("returns conflict when deleting the current branch", async () => {
    gitMocks.deleteBranch.mockReturnValue({
      success: false,
      error: "Cannot delete the current branch 'main'",
    });

    const request = new NextRequest("http://localhost/api/clone/branches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: "/tmp/repos/demo",
        branch: "main",
      }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      error: "Cannot delete the current branch 'main'",
    });
  });
});
