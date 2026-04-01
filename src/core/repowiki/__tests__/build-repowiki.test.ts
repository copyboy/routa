import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Codebase } from "@/core/models/codebase";
import { buildRepoWiki } from "../build-repowiki";

function createFixtureDir(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repowiki-test-"));
  fs.mkdirSync(path.join(base, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(base, "src", "core"), { recursive: true });
  fs.mkdirSync(path.join(base, "docs"), { recursive: true });
  fs.mkdirSync(path.join(base, "crates"), { recursive: true });

  fs.writeFileSync(path.join(base, "README.md"), "# RepoWiki Fixture");
  fs.writeFileSync(path.join(base, "AGENTS.md"), "agent contract");
  fs.writeFileSync(path.join(base, "package.json"), "{}");
  fs.writeFileSync(path.join(base, "src", "app", "page.tsx"), "export default function Page() { return null; }");
  fs.writeFileSync(path.join(base, "src", "core", "model.ts"), "export const model = {};\n");
  fs.writeFileSync(path.join(base, "docs", "ARCHITECTURE.md"), "# Architecture");

  return base;
}

describe("buildRepoWiki", () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = createFixtureDir();
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("builds a normalized RepoWiki payload with storyline context", () => {
    const codebase: Codebase = {
      id: "cb-repowiki",
      workspaceId: "ws-1",
      repoPath: fixtureDir,
      branch: "main",
      label: "fixture",
      sourceType: "local",
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const wiki = buildRepoWiki(codebase);

    expect(wiki.codebase.id).toBe("cb-repowiki");
    expect(wiki.summary.totalFiles).toBeGreaterThan(0);
    expect(wiki.anchors.some((anchor) => anchor.path === "README.md")).toBe(true);
    expect(wiki.modules.some((module) => module.path === "src")).toBe(true);
    expect(wiki.architecture.runtimeBoundaries.length).toBeGreaterThan(0);
    expect(wiki.workflows.length).toBeGreaterThan(0);
    expect(wiki.glossary.length).toBeGreaterThan(0);
    expect(wiki.sourceLinks.length).toBeGreaterThan(0);
    expect(wiki.storylineContext.suggestedSections).toContain("Top-level architecture");
  });
});
