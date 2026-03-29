"use client";

import { useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import type { GitHubActionsFlow, GitHubActionsJob } from "@/client/hooks/use-harness-settings-data";

type HarnessGitHubActionsFlowGalleryProps = {
  flows: GitHubActionsFlow[];
  repoLabel: string;
  variant?: "full" | "compact";
};

type WorkflowCategoryKey = "Validation" | "Release" | "Automation" | "Maintenance";
type WorkflowJobKind = GitHubActionsJob["kind"];

type WorkflowCategoryDefinition = {
  key: WorkflowCategoryKey;
  description: string;
  emptyHint: string;
};

type WorkflowCategoryEntry = WorkflowCategoryDefinition & {
  flows: GitHubActionsFlow[];
};

const CATEGORY_DEFINITIONS: WorkflowCategoryDefinition[] = [
  {
    key: "Validation",
    description: "PR gates, branch protections, and CI validation loops.",
    emptyHint: "No validation workflows detected.",
  },
  {
    key: "Release",
    description: "Packaging, publishing, deployment, and release promotion.",
    emptyHint: "No release workflows detected.",
  },
  {
    key: "Automation",
    description: "Issue automation, workflow dispatch, and repository bots.",
    emptyHint: "No automation workflows detected.",
  },
  {
    key: "Maintenance",
    description: "Scheduled cleanup, hygiene tasks, and background maintenance.",
    emptyHint: "No maintenance workflows detected.",
  },
];

const JOB_KIND_STYLES: Record<WorkflowJobKind, string> = {
  job: "border-slate-200 bg-white/90 text-slate-600",
  approval: "border-amber-200 bg-amber-50 text-amber-700",
  release: "border-violet-200 bg-violet-50 text-violet-700",
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalizeEventTokens(event: string) {
  return event
    .toLowerCase()
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function humanizeToken(value: string) {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStageLabel(index: number) {
  return `Stage ${String(index + 1).padStart(2, "0")}`;
}

function classifyWorkflowCategory(flow: GitHubActionsFlow): WorkflowCategoryKey {
  const eventTokens = normalizeEventTokens(flow.event);
  const eventString = eventTokens.join(",");
  const flowName = flow.name.toLowerCase();
  const hasEvent = (value: string) => eventString.includes(value);

  if (
    flowName.includes("release")
    || flowName.includes("publish")
    || flowName.includes("deploy")
    || flowName.includes("pages")
    || flowName.includes("ship")
  ) {
    return "Release";
  }

  if (
    eventTokens.length === 1
    && eventTokens[0] === "schedule"
  ) {
    return "Maintenance";
  }

  if (
    hasEvent("schedule")
    || flowName.includes("cleanup")
    || flowName.includes("collector")
    || flowName.includes("garbage")
    || flowName.includes("hygiene")
    || flowName.includes("repair")
    || flowName.includes("fixer")
    || flowName.includes("delete merged branches")
  ) {
    return "Maintenance";
  }

  if (
    hasEvent("issues")
    || hasEvent("issue")
    || hasEvent("issue_comment")
    || hasEvent("discussion")
    || hasEvent("repository_dispatch")
    || flowName.includes("issue")
    || flowName.includes("copilot")
    || flowName.includes("enricher")
    || flowName.includes("bot")
    || flowName.includes("handler")
  ) {
    return "Automation";
  }

  if (
    hasEvent("pull_request")
    || hasEvent("pull_request_target")
    || hasEvent("push")
    || hasEvent("workflow_run")
    || hasEvent("merge_group")
    || hasEvent("workflow_call")
  ) {
    return "Validation";
  }

  return "Automation";
}

function buildDependencyLanes(jobs: GitHubActionsJob[]) {
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const depthMap = new Map<string, number>();
  const visiting = new Set<string>();

  function resolveDepth(jobId: string): number {
    if (depthMap.has(jobId)) {
      return depthMap.get(jobId) ?? 0;
    }
    if (visiting.has(jobId)) {
      return 0;
    }

    visiting.add(jobId);
    const job = jobMap.get(jobId);
    const depth = !job || job.needs.length === 0
      ? 0
      : Math.max(...job.needs.map((need) => resolveDepth(need))) + 1;
    visiting.delete(jobId);
    depthMap.set(jobId, depth);
    return depth;
  }

  jobs.forEach((job) => {
    resolveDepth(job.id);
  });

  const lanes = new Map<number, GitHubActionsJob[]>();
  jobs.forEach((job) => {
    const depth = depthMap.get(job.id) ?? 0;
    const lane = lanes.get(depth);
    if (lane) {
      lane.push(job);
      return;
    }
    lanes.set(depth, [job]);
  });

  return [...lanes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, laneJobs]) => laneJobs);
}

function summarizeFlows(flows: GitHubActionsFlow[]) {
  const triggerSet = new Set<string>();
  let totalJobs = 0;

  flows.forEach((flow) => {
    normalizeEventTokens(flow.event).forEach((token) => triggerSet.add(token));
    totalJobs += flow.jobs.length;
  });

  return {
    workflowCount: flows.length,
    triggerTypeCount: triggerSet.size,
    jobCount: totalJobs,
  };
}

function countDependencies(flow: GitHubActionsFlow) {
  return flow.jobs.reduce((sum, job) => sum + job.needs.length, 0);
}

function summarizeStageCount(flow: GitHubActionsFlow) {
  return buildDependencyLanes(flow.jobs).length;
}

function createCategoryEntries(flows: GitHubActionsFlow[]): WorkflowCategoryEntry[] {
  return CATEGORY_DEFINITIONS.map((definition) => ({
    ...definition,
    flows: flows.filter((flow) => classifyWorkflowCategory(flow) === definition.key),
  }));
}

function CategoryIcon({ category }: { category: WorkflowCategoryKey }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    className: "h-4 w-4",
  };

  switch (category) {
    case "Validation":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 9.25 17 19 7.5" />
        </svg>
      );
    case "Release":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" />
        </svg>
      );
    case "Automation":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v4M15 17v4M5.5 6.5l2.8 2.8M15.7 14.7l2.8 2.8M3 12h4m10 0h4M5.5 17.5l2.8-2.8m7.4-5.4 2.8-2.8M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      );
    case "Maintenance":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6.5 8 4l2.5-2.5M13.5 17.5 16 20l-2.5 2.5M6 7.5A7 7 0 0 1 18 12M18 16.5A7 7 0 0 1 6 12" />
        </svg>
      );
  }
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(245,248,252,0.94))] px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1.5 text-[20px] font-semibold tracking-[-0.03em] text-slate-900">{value}</div>
      <div className="mt-0.5 text-[10px] leading-5 text-slate-500">{detail}</div>
    </article>
  );
}

function CategoryRail({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: WorkflowCategoryEntry[];
  selectedCategory: WorkflowCategoryKey;
  onSelect: (category: WorkflowCategoryKey) => void;
}) {
  return (
    <aside className="rounded-[26px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.9)_22%,rgba(242,247,252,0.92)_100%)] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Categories</div>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">Workflow taxonomy</h3>
        </div>
        <div className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-500">
          {categories.reduce((sum, category) => sum + category.flows.length, 0)} flows
        </div>
      </div>

      <div className="mt-3.5 space-y-2">
        {categories.map((category) => {
          const selected = selectedCategory === category.key;
          const disabled = category.flows.length === 0;

          return (
            <button
              key={category.key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(category.key)}
              className={cx(
                "w-full rounded-[20px] border px-3 py-2.5 text-left transition-all",
                disabled
                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                  : selected
                  ? "border-sky-300 bg-sky-50/90 shadow-[0_12px_32px_rgba(59,130,246,0.08)]"
                  : "border-slate-200/80 bg-white/85 hover:border-slate-300 hover:bg-white",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cx(
                    "mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-[10px] border",
                    selected ? "border-sky-200 bg-white text-sky-600" : "border-slate-200 bg-slate-50 text-slate-500",
                  )}>
                    <CategoryIcon category={category.key} />
                  </span>
                  <div className="min-w-0">
                    <div className={cx("text-[13px] font-semibold", disabled ? "text-slate-400" : "text-slate-900")}>
                      {category.key}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{category.description}</div>
                  </div>
                </div>
                <span className={cx(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[10px]",
                  selected ? "border-sky-200 bg-white text-sky-700" : "border-slate-200 bg-slate-50 text-slate-500",
                )}>
                  {category.flows.length}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function CategoryTabs({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: WorkflowCategoryEntry[];
  selectedCategory: WorkflowCategoryKey;
  onSelect: (category: WorkflowCategoryKey) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {categories.map((category) => {
        const selected = selectedCategory === category.key;
        const disabled = category.flows.length === 0;

        return (
          <button
            key={category.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(category.key)}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-medium transition-colors",
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : selected
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white/90 text-slate-600",
            )}
          >
            <CategoryIcon category={category.key} />
            <span>{category.key}</span>
            <span className="rounded-full border border-current/15 px-1.5 py-0.5 text-[10px]">{category.flows.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function MiniDagPreview({ flow }: { flow: GitHubActionsFlow }) {
  const lanes = buildDependencyLanes(flow.jobs);
  const visibleLanes = lanes.slice(0, 4);
  const hiddenLaneCount = Math.max(lanes.length - visibleLanes.length, 0);

  return (
    <div className="rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(243,247,252,0.96))] px-2.5 py-2.5">
      <div className="flex min-w-max items-start gap-2.5 overflow-x-auto pb-1">
        <div className="w-28 shrink-0 rounded-[18px] border border-sky-200/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.9),rgba(255,255,255,0.96))] px-2.5 py-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700">Trigger</div>
          <div className="mt-1.5 text-[10px] font-semibold leading-4 text-slate-900">{humanizeToken(normalizeEventTokens(flow.event)[0] ?? flow.event)}</div>
        </div>

        {visibleLanes.map((laneJobs, laneIndex) => (
          <div key={`${flow.id}:lane:${laneIndex}`} className="flex items-start gap-2.5">
            <div className="flex h-8 items-center text-slate-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
              </svg>
            </div>
            <div className="w-36 shrink-0 space-y-1.5">
              {laneJobs.slice(0, 1).map((job) => (
                <div key={job.id} className="rounded-[18px] border border-slate-200 bg-white/92 px-2.5 py-2">
                  <div className="truncate text-[11px] font-semibold text-slate-900">{job.name}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] text-slate-500">{job.runner}</span>
                    <span className={cx("rounded-full border px-1.5 py-0.5 text-[9px]", JOB_KIND_STYLES[job.kind])}>{job.kind}</span>
                  </div>
                </div>
              ))}
              {laneJobs.length > 1 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-white/75 px-2.5 py-1.5 text-[10px] text-slate-500">
                  +{laneJobs.length - 1} more jobs
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {hiddenLaneCount > 0 ? (
          <div className="flex items-start gap-3">
            <div className="flex h-8 items-center text-slate-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
              </svg>
            </div>
            <div className="w-24 shrink-0 rounded-[18px] border border-dashed border-slate-200 bg-white/75 px-2.5 py-2.5 text-[10px] text-slate-500">
              +{hiddenLaneCount} more stages
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowCard({
  flow,
  selected,
  onSelect,
}: {
  flow: GitHubActionsFlow;
  selected: boolean;
  onSelect: () => void;
}) {
  const eventTokens = normalizeEventTokens(flow.event);
  const stageCount = summarizeStageCount(flow);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        "w-full rounded-[24px] border px-3.5 py-3.5 text-left transition-all",
        selected
          ? "border-sky-300 bg-[linear-gradient(180deg,rgba(250,252,255,0.98),rgba(238,246,255,0.98))] shadow-[0_18px_44px_rgba(59,130,246,0.08)]"
          : "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,252,0.95))] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:shadow-[0_16px_40px_rgba(15,23,42,0.06)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workflow</div>
          <h4 className="mt-1.5 truncate text-[15px] font-semibold tracking-[-0.02em] text-slate-900">{flow.name}</h4>
        </div>
        <div className="shrink-0 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] text-slate-500">
          {flow.jobs.length} jobs
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {eventTokens.map((token) => (
          <span key={`${flow.id}:${token}`} className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] font-medium text-slate-600">
            {token}
          </span>
        ))}
      </div>

      <div className="mt-3">
        <MiniDagPreview flow={flow} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1">
            {stageCount} stages
          </span>
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1">
            {countDependencies(flow)} dependencies
          </span>
        </div>
        {flow.relativePath ? (
          <span className="truncate font-mono text-[10px]">{flow.relativePath}</span>
        ) : null}
      </div>
    </button>
  );
}

function FlowCanvas({
  flow,
  activeJobId,
  onJobSelect,
  compactMode,
}: {
  flow: GitHubActionsFlow;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
  compactMode: boolean;
}) {
  const lanes = buildDependencyLanes(flow.jobs);
  const eventTokens = normalizeEventTokens(flow.event);

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,252,0.95))] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pipeline</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">{flow.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {eventTokens.map((token) => (
              <span key={`${flow.id}:detail:${token}`} className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-600">
                {token}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {flow.jobs.length} jobs
          </span>
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {lanes.length} stages
          </span>
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {countDependencies(flow)} edges
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-3">
          <div className={cx(
            "shrink-0 rounded-[20px] border border-sky-200/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.92),rgba(255,255,255,0.98))] p-3.5",
            compactMode ? "w-44" : "w-52",
          )}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">Trigger source</div>
            <div className="mt-2.5 space-y-1.5">
              {eventTokens.map((token) => (
                <div key={`${flow.id}:trigger:${token}`} className="rounded-[16px] border border-white/70 bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-slate-700">
                  {humanizeToken(token)}
                </div>
              ))}
            </div>
          </div>

          {lanes.map((laneJobs, laneIndex) => (
            <div key={`${flow.id}:canvas-lane:${laneIndex}`} className="flex items-start gap-3">
              <div className="flex h-10 items-center text-slate-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
                </svg>
              </div>
              <div className={cx("shrink-0 space-y-2.5", compactMode ? "w-60" : "w-64")}>
                <div className="pl-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{formatStageLabel(laneIndex)}</div>
                {laneJobs.map((job) => {
                  const selected = activeJobId === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => onJobSelect(job.id)}
                      className={cx(
                        "w-full rounded-[20px] border px-3 py-2.5 text-left transition-all",
                        selected
                          ? "border-sky-300 bg-[linear-gradient(180deg,rgba(250,252,255,0.98),rgba(239,246,255,0.98))] shadow-[0_16px_36px_rgba(59,130,246,0.08)]"
                          : "border-slate-200 bg-white/92 hover:border-slate-300",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-slate-900">{job.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono text-slate-500">{job.runner}</div>
                        </div>
                        <span className={cx("rounded-full border px-2 py-0.5 text-[10px]", JOB_KIND_STYLES[job.kind])}>
                          {job.kind}
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {job.stepCount !== null ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                            {job.stepCount} steps
                          </span>
                        ) : null}
                        {job.needs.length > 0 ? job.needs.map((need) => (
                          <span key={`${job.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                            {need}
                          </span>
                        )) : (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                            root
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function JobInspector({
  flow,
  activeJob,
  compactMode,
}: {
  flow: GitHubActionsFlow;
  activeJob: GitHubActionsJob | null;
  compactMode: boolean;
}) {
  return (
    <aside className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,252,0.95))] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inspector</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
            {activeJob?.name ?? flow.name}
          </h3>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            {activeJob
              ? "Selected job metadata, upstream dependencies, and execution context."
              : "Workflow-level metadata and source definition."}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-500">
          {activeJob ? "Job detail" : "Workflow detail"}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Runner</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-700">{activeJob?.runner ?? "n/a"}</div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Step count</div>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">
            {activeJob?.stepCount ?? "Unknown"}
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dependencies</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeJob?.needs.length ? activeJob.needs.map((need) => (
              <span key={`${activeJob.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                {need}
              </span>
            )) : (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                root
              </span>
            )}
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Source path</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-700">{flow.relativePath ?? "n/a"}</div>
        </div>
      </div>

      <div className="mt-3 rounded-[20px] border border-slate-200 bg-white/90 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Trigger set</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {normalizeEventTokens(flow.event).map((token) => (
            <span key={`${flow.id}:inspector:${token}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600">
              {token}
            </span>
          ))}
        </div>
      </div>

      {!compactMode ? (
        <details className="mt-3 rounded-[20px] border border-slate-200 bg-white/90 p-3">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Workflow YAML
          </summary>
          <div className="mt-3">
            <CodeViewer
              code={flow.yaml}
              filename={`${flow.id}.github-actions.yml`}
              language="yaml"
              maxHeight="320px"
              showHeader={false}
              wordWrap
            />
          </div>
        </details>
      ) : null}
    </aside>
  );
}

export function HarnessGitHubActionsFlowGallery({
  flows,
  repoLabel,
  variant = "full",
}: HarnessGitHubActionsFlowGalleryProps) {
  const compactMode = variant === "compact";
  const summary = useMemo(() => summarizeFlows(flows), [flows]);
  const categories = useMemo(() => createCategoryEntries(flows), [flows]);
  const firstCategory = useMemo(
    () => categories.find((category) => category.flows.length > 0)?.key ?? "Validation",
    [categories],
  );

  const [selectedCategory, setSelectedCategory] = useState<WorkflowCategoryKey>("Validation");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");

  const effectiveCategory = categories.find((category) => category.key === selectedCategory && category.flows.length > 0)?.key ?? firstCategory;
  const activeCategory = categories.find((category) => category.key === effectiveCategory) ?? categories[0];
  const activeFlow = activeCategory?.flows.find((flow) => flow.id === selectedFlowId) ?? activeCategory?.flows[0] ?? null;
  const activeJob = activeFlow?.jobs.find((job) => job.id === selectedJobId) ?? activeFlow?.jobs[0] ?? null;

  const cardsSection = (
    <section className="rounded-[26px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,252,0.95))] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Repository workflows</div>
          <h2 className="mt-1.5 text-[24px] font-semibold tracking-[-0.04em] text-slate-950">
            GitHub Actions Flow Gallery
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            Structured workflow inventory with grouped triggers and compact execution graphs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-slate-500">
            Repository
          </span>
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 font-medium text-slate-700">
            {repoLabel}
          </span>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700">
            Gallery view
          </span>
        </div>
      </div>

      <div className={cx("mt-3 grid gap-2", compactMode ? "w-full sm:grid-cols-3" : "lg:grid-cols-3")}>
        <MetricCard label="Workflows" value={summary.workflowCount} detail="Pipeline definitions" />
        <MetricCard label="Trigger Types" value={summary.triggerTypeCount} detail="Distinct events" />
        <MetricCard label="Jobs" value={summary.jobCount} detail="Execution nodes" />
      </div>

      <div className="mt-3.5 flex flex-wrap items-start justify-between gap-3 border-t border-slate-200/80 pt-3.5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Gallery</div>
          <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-slate-900">{activeCategory?.key}</h3>
          <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{activeCategory?.description}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-slate-500">
            {activeCategory?.flows.length ?? 0} flows
          </span>
          {activeFlow ? (
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-slate-500">
              {summarizeStageCount(activeFlow)} stages in focus
            </span>
          ) : null}
        </div>
      </div>

      {(activeCategory?.flows.length ?? 0) > 0 ? (
        <div className={cx("mt-3.5 grid gap-3", compactMode ? "grid-cols-1" : "xl:grid-cols-2")}>
          {activeCategory?.flows.map((flow) => (
            <WorkflowCard
              key={flow.id}
              flow={flow}
              selected={activeFlow?.id === flow.id}
              onSelect={() => {
                setSelectedFlowId(flow.id);
                setSelectedJobId("");
              }}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[24px] border border-dashed border-slate-200 bg-white/70 px-4 py-10 text-center text-[12px] text-slate-500">
          {activeCategory?.emptyHint}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      {compactMode ? (
        <div className="space-y-3.5">
          <CategoryTabs
            categories={categories}
            selectedCategory={effectiveCategory}
            onSelect={(category) => {
              setSelectedCategory(category);
              setSelectedFlowId("");
              setSelectedJobId("");
            }}
          />
          {cardsSection}
          {activeFlow ? (
            <div className="space-y-3.5">
              <FlowCanvas
                flow={activeFlow}
                activeJobId={activeJob?.id ?? ""}
                onJobSelect={setSelectedJobId}
                compactMode
              />
              <JobInspector flow={activeFlow} activeJob={activeJob} compactMode />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[232px_minmax(0,1fr)]">
          <CategoryRail
            categories={categories}
            selectedCategory={effectiveCategory}
            onSelect={(category) => {
              setSelectedCategory(category);
              setSelectedFlowId("");
              setSelectedJobId("");
            }}
          />
          <div className="space-y-4">
            {cardsSection}
            {activeFlow ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_340px]">
                <FlowCanvas
                  flow={activeFlow}
                  activeJobId={activeJob?.id ?? ""}
                  onJobSelect={setSelectedJobId}
                  compactMode={false}
                />
                <JobInspector flow={activeFlow} activeJob={activeJob} compactMode={false} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
