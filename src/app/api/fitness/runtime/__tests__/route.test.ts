import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

function runtimeRoot(repoRoot: string): string {
  const marker = createHash("sha256").update(repoRoot).digest("hex");
  return path.join("/tmp", "harness-monitor", "runtime", marker);
}

describe("/api/fitness/runtime route", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(runtimeRoot(dir), { recursive: true, force: true });
    }
  });

  it("returns a running mode together with the previous completed snapshot", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-runtime-fitness-"));
    tempDirs.push(repoRoot);

    const root = runtimeRoot(repoRoot);
    fs.mkdirSync(path.join(root, "artifacts", "fitness"), { recursive: true });
    fs.mkdirSync(path.join(root), { recursive: true });

    fs.writeFileSync(
      path.join(root, "events.jsonl"),
      [
        JSON.stringify({
          type: "fitness",
          repo_root: repoRoot,
          observed_at_ms: 1_700_000_000_000,
          mode: "full",
          status: "passed",
          final_score: 93.2,
          hard_gate_blocked: false,
          score_blocked: false,
          duration_ms: 3210,
          dimension_count: 8,
          metric_count: 18,
          artifact_path: path.join(root, "artifacts", "fitness", "latest-full.json"),
        }),
        JSON.stringify({
          type: "fitness",
          repo_root: repoRoot,
          observed_at_ms: 1_700_000_010_000,
          mode: "full",
          status: "running",
          metric_count: 19,
        }),
        "",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(root, "artifacts", "fitness", "latest-full.json"),
      JSON.stringify({
        generated_at_ms: 1_700_000_000_000,
        final_score: 93.2,
        hard_gate_blocked: false,
        score_blocked: false,
        duration_ms: 3210,
        metric_count: 18,
        dimensions: new Array(8).fill({}),
      }),
      "utf-8",
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/fitness/runtime?repoPath=${encodeURIComponent(repoRoot)}`,
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.repoRoot).toBe(repoRoot);
    expect(data.hasRunning).toBe(true);
    expect(data.latest).toMatchObject({
      mode: "full",
      currentStatus: "running",
      metricCount: 19,
    });

    const full = data.modes.find((entry: { mode: string }) => entry.mode === "full");
    expect(full).toMatchObject({
      currentStatus: "running",
      lastCompleted: {
        status: "passed",
        finalScore: 93.2,
        hardGateBlocked: false,
        scoreBlocked: false,
        dimensionCount: 8,
        metricCount: 18,
      },
    });

    const fast = data.modes.find((entry: { mode: string }) => entry.mode === "fast");
    expect(fast?.currentStatus).toBe("missing");
  });

  it("returns missing when the runtime cache does not exist yet", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-runtime-fitness-empty-"));
    tempDirs.push(repoRoot);

    const response = await GET(new NextRequest(
      `http://localhost/api/fitness/runtime?repoPath=${encodeURIComponent(repoRoot)}`,
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasRunning).toBe(false);
    expect(data.latest).toBeNull();
    expect(data.modes).toEqual([
      expect.objectContaining({ mode: "fast", currentStatus: "missing" }),
      expect.objectContaining({ mode: "full", currentStatus: "missing" }),
    ]);
  });
});
