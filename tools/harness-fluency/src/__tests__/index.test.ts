import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateHarnessFluency,
  formatTextReport,
  loadFluencyModel,
  parseArgs,
} from "../index.js";

function writeJson(targetPath: string, value: unknown): void {
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("loadFluencyModel", () => {
  it("loads the production model and enforces at least two criteria per cell", async () => {
    const model = await loadFluencyModel(
      path.resolve(process.cwd(), "docs/fitness/harness-fluency.model.yaml"),
    );

    expect(model.levels).toHaveLength(5);
    expect(model.dimensions).toHaveLength(5);
    expect(model.criteria).toHaveLength(50);

    for (const level of model.levels) {
      for (const dimension of model.dimensions) {
        const criteria = model.criteria.filter(
          (criterion) => criterion.level === level.id && criterion.dimension === dimension.id,
        );
        expect(criteria.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("rejects invalid regex flags in command_output_regex detectors", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-model-"));
    const modelPath = path.join(repoRoot, "model.yaml");

    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: one
    recommended_action: one
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.regex
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: two
    recommended_action: two
    evidence_hint: regex
    detector:
      type: command_output_regex
      command: node -p process.platform
      pattern: linux
      flags: xyz
`,
      "utf8",
    );

    await expect(loadFluencyModel(modelPath)).rejects.toThrow("invalid regex settings");
  });
});

describe("parseArgs", () => {
  it("accepts repo-root and json aliases", () => {
    const options = parseArgs(["--repo-root", "/tmp/repo", "--json", "--compare-last", "--no-save"]);

    expect(options.repoRoot).toBe("/tmp/repo");
    expect(options.format).toBe("json");
    expect(options.compareLast).toBe(true);
    expect(options.save).toBe(false);
    expect(options.modelPath).toBe("/tmp/repo/docs/fitness/harness-fluency.model.yaml");
  });
});

describe("evaluateHarnessFluency", () => {
  it("evaluates a small repo, persists snapshots, and compares against the last run", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".github", "workflows"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeJson(path.join(repoRoot, "package.json"), {
      scripts: {
        lint: "eslint .",
        "test:run": "vitest run",
      },
    });
    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(path.join(repoRoot, ".github", "workflows", "guard.yml"), "jobs:\n  build:\n    steps: []\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.operating_contract
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: Repo guidance must be durable.
    recommended_action: Add an AGENTS contract.
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.lint_script
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: Teams need a baseline feedback loop.
    recommended_action: Add a lint script.
    evidence_hint: package.json scripts.lint
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, lint]
  - id: collaboration.assisted.test_script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: Assisted flows should verify changes.
    recommended_action: Add a test runner script.
    evidence_hint: package.json scripts.test:run
    detector:
      type: json_path_exists
      path: package.json
      jsonPath: [scripts, "test:run"]
  - id: collaboration.assisted.guard_workflow
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: Assisted flows should surface automation hooks.
    recommended_action: Add a guard workflow.
    evidence_hint: .github/workflows/guard.yml
    detector:
      type: yaml_path_exists
      path: .github/workflows/guard.yml
      yamlPath: [jobs, build, steps]
`,
      "utf8",
    );

    const firstReport = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: true,
      save: true,
    });
    expect(firstReport.overallLevel).toBe("assisted");
    expect(firstReport.comparison).toBeNull();

    const guardWorkflow = path.join(repoRoot, ".github", "workflows", "guard.yml");
    writeFileSync(guardWorkflow, "name: guard\n", "utf8");

    const secondReport = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: true,
      save: false,
    });

    expect(secondReport.overallLevel).toBe("awareness");
    expect(secondReport.comparison?.overallChange).toBe("down");
    expect(secondReport.comparison?.criteriaChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.assisted.guard_workflow",
          previousStatus: "pass",
          currentStatus: "fail",
        }),
      ]),
    );

    const textReport = formatTextReport(secondReport);
    expect(textReport).toContain("HARNESS FLUENCY REPORT");
    expect(textReport).toContain("Blocking Gaps To Assisted");
  });

  it("covers remaining detector types with safe command execution", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-detectors-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    mkdirSync(path.join(repoRoot, "docs", "issues"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".claude", "skills"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, ".claude", "skills", "README.md"), "skill\n", "utf8");
    writeFileSync(path.join(repoRoot, "docs", "issues", "one.md"), "# one\n", "utf8");
    writeFileSync(path.join(repoRoot, "docs", "issues", "two.md"), "# two\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.skill_dir
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: skills matter
    recommended_action: add skills
    evidence_hint: .claude/skills
    detector:
      type: any_file_exists
      paths:
        - .claude/skills
        - .agents/skills
  - id: collaboration.awareness.issue_history
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: history matters
    recommended_action: add issues
    evidence_hint: docs/issues/*.md
    detector:
      type: glob_count
      patterns:
        - docs/issues/*.md
      min: 2
  - id: collaboration.assisted.command_exit
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: command checks matter
    recommended_action: add command checks
    evidence_hint: node -p 1
    detector:
      type: command_exit_code
      command: node -p 1
      expectedExitCode: 0
  - id: collaboration.assisted.command_output
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: output checks matter
    recommended_action: add output checks
    evidence_hint: node -p process.platform
    detector:
      type: command_output_regex
      command: node -p process.platform
      pattern: ^(darwin|linux|win32)$
      flags: ""
  - id: collaboration.assisted.attestation
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: manual checks matter
    recommended_action: document manual checks
    evidence_hint: manual prompt
    detector:
      type: manual_attestation
      prompt: Confirm org process
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.overallLevel).toBe("assisted");
    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "collaboration.awareness.skill_dir", status: "pass" }),
        expect.objectContaining({ id: "collaboration.awareness.issue_history", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.command_exit", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.command_output", status: "pass" }),
        expect.objectContaining({ id: "collaboration.assisted.attestation", status: "skipped" }),
      ]),
    );
  });

  it("fails disallowed command executables instead of executing via shell", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-guard-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.command
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: command
    recommended_action: command
    evidence_hint: bash -lc pwd
    detector:
      type: command_exit_code
      command: bash -lc pwd
      expectedExitCode: 0
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.awareness.command",
          status: "fail",
          detail: expect.stringContaining('command executable "bash" is not allowed'),
        }),
      ]),
    );
  });

  it("rejects path-based command executables before allowlist checks", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-fluency-path-guard-"));
    mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });

    const modelPath = path.join(repoRoot, "docs", "fitness", "model.yaml");
    const snapshotPath = path.join(repoRoot, "docs", "fitness", "latest.json");

    writeFileSync(path.join(repoRoot, "AGENTS.md"), "# contract\n", "utf8");
    writeFileSync(
      modelPath,
      `version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.command
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: command
    recommended_action: command
    evidence_hint: ./node -p 1
    detector:
      type: command_exit_code
      command: ./node -p 1
      expectedExitCode: 0
`,
      "utf8",
    );

    const report = await evaluateHarnessFluency({
      repoRoot,
      modelPath,
      snapshotPath,
      compareLast: false,
      save: false,
    });

    expect(report.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collaboration.awareness.command",
          status: "fail",
          detail: expect.stringContaining('command executable "./node" must be a bare allowlisted name'),
        }),
      ]),
    );
  });
});
