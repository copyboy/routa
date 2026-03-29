"use client";

import {
  criterionShortLabel,
  humanizeToken,
  type CriterionResult,
  type FitnessProfile,
  type FitnessProfileState,
  type FitnessReport,
  type FluencyRunMode,
} from "./fitness-analysis-types";

export type FluencyHeroModel = {
  title: string;
  subtitle: string;
  currentLevel: string;
  targetLevel: string;
  capabilitySummary: string;
  confidenceSummary: string;
};

export type FluencyBlockerCard = {
  id: string;
  title: string;
  impactSummary: string;
  whyItMatters: string;
  evidenceHint: string;
  recommendedAction: string;
  critical: boolean;
  severityLabel: string;
};

export type FluencyRemediationItem = {
  id: string;
  title: string;
  impactSummary: string;
  startingPoint: string;
  targetLevel: string;
  critical: boolean;
};

export type FluencyScoringExplainer = Array<{
  title: string;
  description: string;
}>;

function getCapabilitySummary(levelName: string | undefined) {
  switch (levelName) {
    case "Awareness":
      return "Agent 只能识别仓库表面结构，仍然需要大量人工指路。";
    case "Assisted-Coding":
      return "Agent 可以完成局部改动，但验证和上下文仍然容易断裂。";
    case "Structured-AI-Coding":
      return "Agent 可以在固定流程内稳定完成常规编码任务。";
    case "Agent-Centric":
      return "Agent 已能完成仓库内的大多数常规任务，但治理和上下文深度还会限制可靠性。";
    case "Agent-First":
      return "仓库已经围绕 agent 协作设计，适合持续自治和高频修复闭环。";
    default:
      return "当前报告会告诉你 agent 在这个仓库里能稳定做什么、还会在哪里卡住。";
  }
}

function inferFailureMode(criterion: CriterionResult) {
  if (criterion.dimension === "governance") {
    return "Guardrails are too weak for autonomous changes";
  }
  if (criterion.dimension === "context") {
    return "Agents lack enough durable context to make safe decisions";
  }
  if (criterion.dimension === "harness") {
    return "Feedback loops are too slow or too implicit";
  }
  if (criterion.dimension === "collaboration") {
    return "Delegation and handoff surfaces are under-specified";
  }
  if (criterion.dimension === "sdlc") {
    return "Delivery process still depends on manual knowledge";
  }
  return `${humanizeToken(criterion.dimension)} is limiting agent throughput`;
}

function buildImpactSummary(criterion: CriterionResult) {
  const base = inferFailureMode(criterion);
  const severity = criterion.critical ? "This is a critical gate" : "This is slowing the next level unlock";
  return `${base}. ${severity}.`;
}

export function buildHeroModel(
  report: FitnessReport | undefined,
  profile: FitnessProfile,
  state: FitnessProfileState,
): FluencyHeroModel {
  if (!report) {
    return {
      title: profile === "generic" ? "Repository Fluency Report" : "Agent Orchestrator Fluency Report",
      subtitle: "Fluency measures how well this repository supports autonomous development and agent collaboration.",
      currentLevel: "No report yet",
      targetLevel: "Run first report",
      capabilitySummary: "先运行一份报告，页面才会告诉你当前 maturity、失败模式和优先修复项。",
      confidenceSummary: state === "loading" ? "正在生成新的 fluency 报告。" : "当前还没有可用报告。",
    };
  }

  const confidence = `${Math.round(report.currentLevelReadiness * 100)}% confidence in current level`;
  return {
    title: profile === "generic" ? "Repository Fluency Report" : "Agent Orchestrator Fluency Report",
    subtitle: "Fluency measures how well this repository supports autonomous development and agent collaboration.",
    currentLevel: report.overallLevelName,
    targetLevel: report.nextLevelName ?? "Current max",
    capabilitySummary: getCapabilitySummary(report.overallLevelName),
    confidenceSummary: confidence,
  };
}

export function buildBlockerCards(report: FitnessReport | undefined): FluencyBlockerCard[] {
  if (!report) {
    return [];
  }

  return (report.blockingCriteria ?? []).slice(0, 4).map((criterion) => ({
    id: criterion.id,
    title: criterionShortLabel(criterion.id),
    impactSummary: buildImpactSummary(criterion),
    whyItMatters: criterion.whyItMatters,
    evidenceHint: criterion.evidenceHint,
    recommendedAction: criterion.recommendedAction,
    critical: criterion.critical,
    severityLabel: criterion.critical ? "Critical gate" : "Priority fix",
  }));
}

export function buildRemediationChecklist(report: FitnessReport | undefined): FluencyRemediationItem[] {
  if (!report) {
    return [];
  }

  return report.recommendations.slice(0, 5).map((item) => ({
    id: item.criterionId,
    title: item.action,
    impactSummary: item.whyItMatters,
    startingPoint: item.evidenceHint,
    targetLevel: report.nextLevelName ?? "Current max",
    critical: item.critical,
  }));
}

export function buildScoringExplainer(
  report: FitnessReport | undefined,
  runMode: FluencyRunMode,
  compareLast: boolean,
  profileState: FitnessProfileState,
): FluencyScoringExplainer {
  const sourceLine = report
    ? `当前结果来自${profileState === "ready" ? "已生成报告" : "本次运行"}，当前 level 命中度为 ${Math.round(report.currentLevelReadiness * 100)}%。`
    : "没有报告时不会显示 level 命中度，也不会解锁 blocker 与 remediation 视图。";

  return [
    {
      title: "What the score means",
      description: sourceLine,
    },
    {
      title: "How levels unlock",
      description: report?.nextLevelName
        ? `当前目标是 ${report.nextLevelName}。你需要先清掉关键 blocker，才能继续解锁下一层 agent capability。`
        : "当前报告已经处在最高层，没有新的 level 需要继续解锁。",
    },
    {
      title: "Why rerun vs compare",
      description: compareLast
        ? `当前开启了历史对比。重跑后可以直接看到这次结果相对上次的变化，适合验证修复是否生效。`
        : "当前未开启历史对比。适合先快速得到静态结论，再决定是否保留历史差异。",
    },
    {
      title: "Analysis mode",
      description: runMode === "deterministic"
        ? "Deterministic 适合做稳定基线。Hybrid 和 AI 模式更适合补证据和排查争议项。"
        : "当前不是 deterministic 模式，结果会更偏向证据准备和深入诊断，而不是最轻量的基线扫描。",
    },
  ];
}

export function buildPrimaryActionLabel(report: FitnessReport | undefined, profileState: FitnessProfileState) {
  if (profileState === "loading") {
    return "Running report...";
  }
  return report ? "Re-run report" : "Run first report";
}
