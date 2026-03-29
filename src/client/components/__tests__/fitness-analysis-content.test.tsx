import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../terminal/terminal-bubble", () => ({
  TerminalBubble: () => <div>terminal</div>,
}));

import { FitnessAnalysisContent } from "../fitness-analysis-content";
import type { FitnessReport } from "../fitness-analysis-types";

const report: FitnessReport = {
  modelVersion: 2,
  modelPath: "/tmp/model.yaml",
  profile: "generic",
  mode: "deterministic",
  repoRoot: "/tmp/repo",
  generatedAt: "2026-03-29T04:50:58.741337+00:00",
  snapshotPath: "/tmp/report.json",
  overallLevel: "agent_centric",
  overallLevelName: "Agent-Centric",
  currentLevelReadiness: 1,
  nextLevel: "agent_first",
  nextLevelName: "Agent-First",
  nextLevelReadiness: 0,
  blockingTargetLevel: "agent_first",
  blockingTargetLevelName: "Agent-First",
  dimensions: {},
  cells: [
    {
      id: "governance:agent_first",
      level: "agent_first",
      levelName: "Agent-First",
      dimension: "governance",
      dimensionName: "Verification & Guardrails",
      score: 0,
      passed: false,
      passedWeight: 0,
      applicableWeight: 3,
      criteria: [
        {
          id: "governance.agent_first.machine_readable_guardrails",
          level: "agent_first",
          dimension: "governance",
          weight: 2,
          critical: true,
          status: "fail",
          detectorType: "all_of",
          detail: "missing CODEOWNERS",
          evidence: ["docs/fitness/review-triggers.yaml"],
          whyItMatters: "Guardrails need machine-readable ownership and dependency controls.",
          recommendedAction: "Add CODEOWNERS or dependency automation.",
          evidenceHint: ".github/CODEOWNERS or renovate.json",
        },
      ],
    },
  ],
  criteria: [
    {
      id: "governance.agent_first.machine_readable_guardrails",
      level: "agent_first",
      dimension: "governance",
      weight: 2,
      critical: true,
      status: "fail",
      detectorType: "all_of",
      detail: "missing CODEOWNERS",
      evidence: ["docs/fitness/review-triggers.yaml"],
      whyItMatters: "Guardrails need machine-readable ownership and dependency controls.",
      recommendedAction: "Add CODEOWNERS or dependency automation.",
      evidenceHint: ".github/CODEOWNERS or renovate.json",
    },
  ],
  recommendations: [
    {
      criterionId: "governance.agent_first.machine_readable_guardrails",
      action: "Pair review-trigger rules with CODEOWNERS or Renovate",
      whyItMatters: "Without a native ownership surface, governance remains concentrated in one file.",
      evidenceHint: ".github/CODEOWNERS plus docs/fitness/review-triggers.yaml",
      critical: true,
      weight: 2,
    },
  ],
  blockingCriteria: [
    {
      id: "governance.agent_first.machine_readable_guardrails",
      level: "agent_first",
      dimension: "governance",
      weight: 2,
      critical: true,
      status: "fail",
      detectorType: "all_of",
      detail: "missing CODEOWNERS",
      evidence: ["docs/fitness/review-triggers.yaml"],
      whyItMatters: "Guardrails need machine-readable ownership and dependency controls.",
      recommendedAction: "Add CODEOWNERS or dependency automation.",
      evidenceHint: ".github/CODEOWNERS or renovate.json",
    },
  ],
  comparison: {
    previousGeneratedAt: "2026-03-29T04:45:58.741337+00:00",
    previousOverallLevel: "agent_centric",
    overallChange: "same",
    dimensionChanges: [],
    criteriaChanges: [],
  },
  evidencePacks: [],
};

describe("FitnessAnalysisContent overview", () => {
  it("renders the repair workbench structure for overview mode", () => {
    render(
      <FitnessAnalysisContent
        selectedProfile="generic"
        viewMode="overview"
        profileState={{ state: "ready", report }}
        report={report}
      />,
    );

    expect(screen.getByText("Repair workbench")).toBeTruthy();
    expect(screen.getByText("Why blocked")).toBeTruthy();
    expect(screen.getByText("Do next")).toBeTruthy();
    expect(screen.getByText("Cross-check")).toBeTruthy();
    expect(screen.getByText("How scoring works")).toBeTruthy();
    expect(screen.getByText("Pair review-trigger rules with CODEOWNERS or Renovate")).toBeTruthy();
    expect(screen.getByText("Start here")).toBeTruthy();
    expect(screen.getByText("Fix next")).toBeTruthy();
    expect(screen.getByText("What the score means")).toBeTruthy();
  });
});
