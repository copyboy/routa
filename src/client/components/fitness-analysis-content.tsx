"use client";

import { useMemo, useState } from "react";
import { TerminalBubble } from "@/client/components/terminal/terminal-bubble";

import {
  clampPercent,
  criterionShortLabel,
  criterionStatusTone,
  formatTime,
  humanizeToken,
  levelChangeTone,
  readinessBadgeTone,
  readinessBarTone,
  type CellResult,
  type CriterionResult,
  type FitnessProfile,
  type FitnessReport,
  type ProfilePanelState,
  type ViewMode,
} from "./fitness-analysis-types";
import {
  buildBlockerCards,
  buildRemediationChecklist,
  buildScoringExplainer,
} from "./fitness-analysis-view-model";

type FitnessAnalysisContentProps = {
  selectedProfile: FitnessProfile;
  viewMode: ViewMode;
  profileState: ProfilePanelState;
  report?: FitnessReport;
  peerReport?: FitnessReport;
};

type DimensionGroup = {
  key: string;
  name: string;
  cells: CellResult[];
  failedCriteria: number;
  criticalFailures: number;
  averageScore: number;
};

function RecommendationCard({
  action,
  whyItMatters,
  evidenceHint,
  critical,
}: {
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
}) {
  return (
    <article className="rounded-xl border border-desktop-border bg-white/80 p-3 dark:bg-white/6">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-desktop-text-primary">{action}</div>
        {critical ? (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
            critical
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{whyItMatters}</div>
      <div className="mt-2 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] text-desktop-text-secondary">
        从这里开始：{evidenceHint}
      </div>
    </article>
  );
}

function sortCells(left: CellResult, right: CellResult) {
  if (left.passed !== right.passed) {
    return left.passed ? 1 : -1;
  }

  return left.score - right.score;
}

function buildDimensionGroups(report: FitnessReport): DimensionGroup[] {
  const groups = new Map<string, DimensionGroup>();

  for (const cell of report.cells) {
    const current = groups.get(cell.dimension) ?? {
      key: cell.dimension,
      name: cell.dimensionName,
      cells: [],
      failedCriteria: 0,
      criticalFailures: 0,
      averageScore: 0,
    };

    current.cells.push(cell);
    current.failedCriteria += cell.criteria.filter((criterion) => criterion.status === "fail").length;
    current.criticalFailures += cell.criteria.filter((criterion) => criterion.critical && criterion.status === "fail").length;
    groups.set(cell.dimension, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cells: group.cells.slice().sort(sortCells),
      averageScore: group.cells.reduce((sum, cell) => sum + cell.score, 0) / Math.max(group.cells.length, 1),
    }))
    .sort((left, right) => {
      if (left.criticalFailures !== right.criticalFailures) {
        return right.criticalFailures - left.criticalFailures;
      }
      if (left.failedCriteria !== right.failedCriteria) {
        return right.failedCriteria - left.failedCriteria;
      }
      return left.averageScore - right.averageScore;
    });
}

function CapabilityCellCard({ cell }: { cell: CellResult }) {
  const score = clampPercent(cell.score);
  const failedCriteria = cell.criteria.filter((criterion) => criterion.status === "fail");
  const criticalFailures = failedCriteria.filter((criterion) => criterion.critical);

  return (
    <article className="rounded-2xl border border-desktop-border bg-white/85 p-4 shadow-sm dark:bg-white/6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
            {cell.dimensionName}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
            {humanizeToken(cell.level)}
          </div>
          <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{cell.levelName}</h4>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readinessBadgeTone(cell.score)}`}>
          {score}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-desktop-bg-primary">
        <div className={`h-full rounded-full ${readinessBarTone(cell.score)}`} style={{ width: `${score}%` }} />
      </div>

      <div className="mt-3 grid gap-2 text-[11px] text-desktop-text-secondary sm:grid-cols-3">
        <div>{cell.passedWeight}/{cell.applicableWeight} weighted checks</div>
        <div>{failedCriteria.length} failing criteria</div>
        <div>{criticalFailures.length} critical blockers</div>
      </div>

      {failedCriteria.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {failedCriteria.slice(0, 4).map((criterion) => (
            <span
              key={criterion.id}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${criterionStatusTone(criterion.status)}`}
            >
              {criterionShortLabel(criterion.id)}
            </span>
          ))}
          {failedCriteria.length > 4 ? (
            <span className="rounded-full border border-desktop-border px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              +{failedCriteria.length - 4}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-desktop-border px-3 py-3 text-[11px] text-desktop-text-secondary">
          No failures
        </div>
      )}
    </article>
  );
}

function CriterionList({ criteria }: { criteria: CriterionResult[] }) {
  if (criteria.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        当前没有阻塞 criterion。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {criteria.map((criterion) => (
        <article key={criterion.id} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-desktop-text-primary">{criterionShortLabel(criterion.id)}</div>
              <div className="mt-1 font-mono text-[10px] text-desktop-text-secondary">{criterion.id}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {criterion.critical ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                  critical
                </span>
              ) : null}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${criterionStatusTone(criterion.status)}`}>
                {criterion.status}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{criterion.whyItMatters}</p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <div className="rounded-xl border border-desktop-border bg-white/75 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary dark:bg-white/6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">建议动作</div>
              <div className="mt-1">{criterion.recommendedAction}</div>
            </div>
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">查看线索</div>
              <div className="mt-1">{criterion.evidenceHint}</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function OverviewView({
  report,
  peerReport,
  profileState,
}: {
  report: FitnessReport;
  peerReport?: FitnessReport;
  profileState: ProfilePanelState;
}) {
  const blockers = report.blockingCriteria ?? [];
  const failedCriteria = report.criteria.filter((criterion) => criterion.status === "fail");
  const evidencePackCount = report.evidencePacks?.length ?? 0;
  const blockerCards = buildBlockerCards(report);
  const remediationItems = buildRemediationChecklist(report);
  const scoringExplainer = buildScoringExplainer(report, (report.mode as "deterministic" | "hybrid" | "ai") ?? "deterministic", Boolean(report.comparison), profileState.state);
  const capabilityHighlights = buildDimensionGroups(report)
    .map((group) => group.cells[0])
    .filter((cell): cell is CellResult => Boolean(cell))
    .slice(0, 6);
  const peerDelta = peerReport
    ? clampPercent(report.currentLevelReadiness) - clampPercent(peerReport.currentLevelReadiness)
    : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Repair workbench</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              blocker {blockers.length}
            </div>
            <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              failed {failedCriteria.length}
            </div>
            {peerDelta !== null ? (
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                peer {peerDelta >= 0 ? "+" : ""}
                {peerDelta}%
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Why blocked</div>
            {blockerCards.length > 0 ? (
              <div className="space-y-3">
                {blockerCards.map((card) => (
                  <article key={card.id} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-desktop-text-primary">{card.title}</div>
                        <div className="mt-1 font-mono text-[10px] text-desktop-text-secondary">{card.id}</div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${card.critical ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                          {card.severityLabel}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{card.impactSummary}</p>
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      <div className="rounded-xl border border-desktop-border bg-white/75 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary dark:bg-white/6">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Why it matters</div>
                        <div className="mt-1">{card.whyItMatters}</div>
                      </div>
                      <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Start here</div>
                        <div className="mt-1">{card.evidenceHint}</div>
                      </div>
                    </div>
                    <div className="mt-2 rounded-xl border border-desktop-border bg-white/75 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary dark:bg-white/6">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Fix next</div>
                      <div className="mt-1">{card.recommendedAction}</div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <CriterionList criteria={blockers.slice(0, 4)} />
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-desktop-border bg-white/80 p-4 dark:bg-white/6">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Do next</div>
              {remediationItems.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {remediationItems.map((item) => (
                    <article key={item.id} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-desktop-text-primary">{item.title}</div>
                        {item.critical ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                            critical
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{item.impactSummary}</div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl border border-desktop-border bg-white/80 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary dark:bg-white/6">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Starting point</div>
                          <div className="mt-1">{item.startingPoint}</div>
                        </div>
                        <div className="rounded-xl border border-desktop-border bg-white/80 px-3 py-2 text-[11px] leading-5 text-desktop-text-secondary dark:bg-white/6">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Unlocks toward</div>
                          <div className="mt-1">{item.targetLevel}</div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-desktop-text-secondary">当前没有建议动作。</p>
              )}
            </div>

            <div className="rounded-2xl border border-desktop-border bg-white/80 p-4 dark:bg-white/6">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Cross-check</div>
              <div className="mt-3 space-y-2 text-[11px] text-desktop-text-secondary">
                <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2">
                  下一目标：<span className="font-semibold text-desktop-text-primary">{report.nextLevelName ?? "当前已到最高级"}</span>
                </div>
                <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2">
                  与另一 profile 的差值：
                  <span className="ml-1 font-semibold text-desktop-text-primary">
                    {peerDelta === null ? "N/A" : `${peerDelta >= 0 ? "+" : ""}${peerDelta}%`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">How scoring works</div>
          </div>
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
            report interpretation
          </div>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {scoringExplainer.map((item) => (
            <article key={item.title} className="rounded-xl border border-desktop-border bg-white/80 p-4 dark:bg-white/6">
              <div className="text-sm font-semibold text-desktop-text-primary">{item.title}</div>
              <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Capability hotspots</div>
          </div>
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
            按 cell 粒度排序
          </div>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {capabilityHighlights.map((cell) => (
            <CapabilityCellCard key={cell.id} cell={cell} />
          ))}
        </div>
      </section>

      {evidencePackCount > 0 ? (
        <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Adjudication prep</div>
              <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">已准备可供后续 AI 裁决的证据包</h3>
            </div>
            <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {report.mode ?? "deterministic"}
            </div>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {report.evidencePacks?.slice(0, 4).map((pack) => (
              <article key={pack.criterionId} className="rounded-xl border border-desktop-border bg-white/80 p-3 dark:bg-white/6">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-desktop-text-primary">{criterionShortLabel(pack.criterionId)}</div>
                    <div className="mt-1 font-mono text-[10px] text-desktop-text-secondary">{pack.criterionId}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${criterionStatusTone(pack.status)}`}>
                    {pack.status}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-desktop-text-secondary">
                  选择原因：{pack.selectionReasons.join(" / ")}
                </div>
                <div className="mt-2 text-[11px] text-desktop-text-secondary">
                  证据：{pack.evidence.slice(0, 3).join(", ") || pack.evidenceHint}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CapabilitiesView({ report }: { report: FitnessReport }) {
  const groups = useMemo(() => buildDimensionGroups(report), [report]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {group.name}
              </div>
              <p className="mt-1 text-[11px] text-desktop-text-secondary">
                {group.cells.length} cells · {group.failedCriteria} failing criteria · {group.criticalFailures} critical blockers
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readinessBadgeTone(group.averageScore)}`}>
              {clampPercent(group.averageScore)}%
            </span>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {group.cells.map((cell) => (
              <CapabilityCellCard key={cell.id} cell={cell} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RecommendationsView({ report }: { report: FitnessReport }) {
  if (report.recommendations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        当前 Profile 没有建议数据。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {report.recommendations.map((item) => (
        <RecommendationCard
          key={item.criterionId}
          action={item.action}
          whyItMatters={item.whyItMatters}
          evidenceHint={item.evidenceHint}
          critical={item.critical}
        />
      ))}
    </div>
  );
}

function ChangesView({ report }: { report: FitnessReport }) {
  if (!report.comparison) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border p-4 text-sm text-desktop-text-secondary">
        当前快照未开启历史对比，或缺少历史快照。重新运行时勾选“与上次对比”即可补充。
      </div>
    );
  }

  const comp = report.comparison;

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="text-sm text-desktop-text-primary">与上次对比：{formatTime(comp.previousGeneratedAt)}</div>
        <div className="mt-2 text-xs text-desktop-text-secondary">
          上次总体：{comp.previousOverallLevel} → 当前总体：{report.overallLevel}
          <span className={`ml-2 font-semibold ${levelChangeTone(comp.overallChange)}`}>
            {comp.overallChange === "up" ? "上升" : comp.overallChange === "down" ? "下降" : "持平"}
          </span>
        </div>
      </article>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">维度变化</div>
          {comp.dimensionChanges.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {comp.dimensionChanges.map((item) => (
                <li key={`${item.dimension}-${item.currentLevel}`} className="flex items-center justify-between text-sm">
                  <span className="text-desktop-text-secondary">{humanizeToken(item.dimension)}</span>
                  <span className="font-semibold text-desktop-text-primary">
                    {item.previousLevel}
                    <span className="px-1 text-desktop-text-secondary">→</span>
                    {item.currentLevel}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">当前未检测到维度变化。</p>
          )}
        </div>
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">关键项状态变化</div>
          {comp.criteriaChanges.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {comp.criteriaChanges.slice(0, 8).map((item) => (
                <li key={item.id} className="rounded-xl border border-desktop-border bg-white/85 p-3 dark:bg-white/6">
                  <div className="font-mono text-[11px] text-desktop-text-secondary">{item.id}</div>
                  <div className="mt-1 text-xs text-desktop-text-secondary">
                    {item.previousStatus ?? "unknown"} → {item.currentStatus ?? "unknown"}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">暂无关键项状态变化。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function RawView({ report }: { report: FitnessReport }) {
  const [copied, setCopied] = useState(false);
  const jsonText = JSON.stringify(report, null, 2);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={async () => {
            if (typeof window === "undefined") {
              return;
            }
            await navigator.clipboard.writeText(jsonText);
            setCopied(true);
            window.setTimeout(() => {
              setCopied(false);
            }, 1200);
          }}
          className="rounded-full border border-desktop-border px-3 py-1.5 text-xs font-semibold text-desktop-text-secondary hover:bg-desktop-bg-primary/70"
        >
          {copied ? "已复制" : "复制 JSON"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-2xl border border-desktop-border bg-slate-950 p-4 text-xs leading-5 text-slate-100">
        <code>{jsonText}</code>
      </pre>
    </div>
  );
}

function ConsoleView({ profileState }: { profileState: ProfilePanelState }) {
  const consoleState = profileState.console;
  const [copied, setCopied] = useState(false);

  if (!consoleState?.data) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        当前没有 console transcript。先运行一次 profile。
        这条 fluency CLI 不会持续输出内部进度；成功时通常只会在结束后一次性输出最终 JSON 报告和 Cargo 的 stderr。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4 text-[11px] text-desktop-text-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <span>
            Command:
            <span className="ml-1 font-mono text-desktop-text-primary">{consoleState.command}</span>
          </span>
          <span>
            Exit:
            <span className="ml-1 font-semibold text-desktop-text-primary">
              {profileState.state === "loading"
                ? "running"
                : consoleState.signal ? `signal ${consoleState.signal}` : consoleState.exitCode ?? "unknown"}
            </span>
          </span>
        </div>
      </div>
      <TerminalBubble
        terminalId={`fluency-console-${profileState.updatedAt ?? "latest"}`}
        command={consoleState.command}
        args={consoleState.args}
        data={consoleState.data}
        exited={profileState.state !== "loading"}
        exitCode={consoleState.signal ? 130 : typeof consoleState.exitCode === "number" ? consoleState.exitCode : undefined}
      />
      {consoleState.reportText ? (
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">JSON output</div>
              <div className="mt-1 text-[11px] text-desktop-text-secondary">
                这是 fluency CLI 最终输出到 stdout 的原始 JSON。
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (typeof window === "undefined") {
                  return;
                }
                await navigator.clipboard.writeText(consoleState.reportText ?? "");
                setCopied(true);
                window.setTimeout(() => {
                  setCopied(false);
                }, 1200);
              }}
              className="rounded-full border border-desktop-border px-3 py-1.5 text-xs font-semibold text-desktop-text-secondary hover:bg-desktop-bg-primary/70"
            >
              {copied ? "已复制" : "复制 JSON"}
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-2xl border border-desktop-border bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            <code>{consoleState.reportText}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function FitnessAnalysisContent({
  selectedProfile,
  viewMode,
  profileState,
  report,
  peerReport,
}: FitnessAnalysisContentProps) {
  if (viewMode === "console") {
    return <ConsoleView profileState={profileState} />;
  }

  if (!report) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary">
        {profileState.state === "loading"
          ? "正在生成 fluency 报告。"
          : profileState.error ?? `当前还没有 ${selectedProfile} 的报告，先运行一次分析。`}
      </div>
    );
  }

  if (viewMode === "capabilities") {
    return <CapabilitiesView report={report} />;
  }

  if (viewMode === "recommendations") {
    return <RecommendationsView report={report} />;
  }

  if (viewMode === "changes") {
    return <ChangesView report={report} />;
  }

  if (viewMode === "raw") {
    return <RawView report={report} />;
  }

  return <OverviewView report={report} peerReport={peerReport} profileState={profileState} />;
}
