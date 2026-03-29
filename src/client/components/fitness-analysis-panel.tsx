"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

import { FitnessAnalysisContent } from "./fitness-analysis-content";
import {
  buildFluencyCommandArgs,
  FLUENCY_MODES,
  PROFILE_DEFS,
  PROFILE_ORDER,
  VIEW_MODES,
  buildAnalysisPayload,
  buildAnalysisQuery,
  clampPercent,
  formatDuration,
  formatTime,
  normalizeApiResponse,
  profileStateTone,
  readinessBarTone,
  type AnalyzeResponse,
  type FitnessProfile,
  type FitnessProfileState,
  type FluencyRunMode,
  type ProfilePanelState,
  type ViewMode,
  toMessage,
} from "./fitness-analysis-types";
import {
  buildHeroModel,
  buildPrimaryActionLabel,
} from "./fitness-analysis-view-model";

type FitnessAnalysisPanelProps = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  codebaseLabel?: string;
};

const EMPTY_STATE: Record<FitnessProfile, ProfilePanelState> = {
  generic: { state: "idle" },
  agent_orchestrator: { state: "idle" },
};

function StatusBadge({ state }: { state: FitnessProfileState }) {
  const labels: Record<FitnessProfileState, string> = {
    idle: "未运行",
    loading: "运行中",
    ready: "有结果",
    empty: "无快照",
    error: "失败",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${profileStateTone(state)}`}>
      {labels[state]}
    </span>
  );
}

function SurfaceCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-desktop-border bg-desktop-bg-secondary/60 p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-desktop-border bg-white/80 p-4 dark:bg-white/6">
      <div className="text-[10px] font-semibold tracking-[0.08em] text-desktop-text-secondary">{label}</div>
      <div className="mt-2 text-lg font-semibold text-desktop-text-primary">{value}</div>
      <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{detail}</p>
    </article>
  );
}

function ViewButton({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
        active
          ? "border-desktop-accent bg-desktop-bg-primary"
          : "border-desktop-border bg-white/70 hover:bg-desktop-bg-primary/80 dark:bg-white/5"
      }`}
    >
      <div className="text-sm font-semibold text-desktop-text-primary">{label}</div>
      <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{description}</div>
    </button>
  );
}

export function FitnessAnalysisPanel({
  workspaceId,
  codebaseId,
  repoPath,
  codebaseLabel,
}: FitnessAnalysisPanelProps) {
  const [selectedProfile, setSelectedProfile] = useState<FitnessProfile>("generic");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [runMode, setRunMode] = useState<FluencyRunMode>("deterministic");
  const [compareLast, setCompareLast] = useState(true);
  const [noSave, setNoSave] = useState(false);
  const [profiles, setProfiles] = useState<Record<FitnessProfile, ProfilePanelState>>(EMPTY_STATE);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);

  const hasContext = Boolean(workspaceId?.trim() || codebaseId?.trim() || repoPath?.trim());
  const contextQuery = buildAnalysisQuery({ workspaceId, codebaseId, repoPath });
  const contextPayload = buildAnalysisPayload({ workspaceId, codebaseId, repoPath }, { mode: runMode });
  const contextLabel = codebaseLabel || repoPath || null;

  const selectedState = profiles[selectedProfile];
  const peerProfile = selectedProfile === "generic" ? "agent_orchestrator" : "generic";
  const peerState = profiles[peerProfile];

  const applyProfiles = useCallback((entries: ReturnType<typeof normalizeApiResponse>) => {
    setProfiles((current) => {
      const next = { ...current };

      for (const profile of PROFILE_ORDER) {
        const entry = entries.find((item) => item.profile === profile);

        if (!entry) {
          next[profile] = {
            ...next[profile],
            state: "empty",
            error: `${new Date().toLocaleTimeString()} 未返回结果`,
          };
          continue;
        }

        if (entry.status === "ok" && entry.report) {
          next[profile] = {
            state: "ready",
            source: entry.source,
            durationMs: entry.durationMs,
            report: entry.report,
            console: entry.console ?? next[profile].console,
            updatedAt: entry.report.generatedAt,
          };
          continue;
        }

        if (entry.status === "missing") {
          next[profile] = {
            state: "empty",
            source: entry.source,
            console: entry.console ?? next[profile].console,
            error: entry.error ?? "暂无快照",
          };
          continue;
        }

        next[profile] = {
          state: "error",
          source: entry.source,
          durationMs: entry.durationMs,
          console: entry.console ?? next[profile].console,
          error: entry.error ?? "分析失败",
        };
      }

      return next;
    });

    setGlobalError(null);
  }, []);

  const syncProfiles = useCallback(async () => {
    if (!hasContext) {
      setProfiles(EMPTY_STATE);
      setLastSnapshotAt(null);
      setGlobalError("请先选择要分析的 Workspace 与 Repository");
      return;
    }

    setGlobalError(null);

    try {
      const reportUrl = contextQuery ? `/api/fitness/report?${contextQuery}` : "/api/fitness/report";
      const response = await desktopAwareFetch(reportUrl, { cache: "no-store" });

      if (!response.ok) {
        const body = await response.text();
        setGlobalError(`获取快照失败: ${response.status} ${body}`);
        return;
      }

      const raw = await response.json().catch(() => null);
      if (raw && typeof raw === "object" && typeof (raw as { generatedAt?: unknown }).generatedAt === "string") {
        setLastSnapshotAt((raw as { generatedAt: string }).generatedAt);
      } else {
        setLastSnapshotAt(new Date().toLocaleString());
      }

      applyProfiles(normalizeApiResponse(raw));
    } catch (error) {
      setGlobalError(`获取快照失败: ${toMessage(error)}`);
    }
  }, [applyProfiles, contextQuery, hasContext]);

  useEffect(() => {
    queueMicrotask(() => {
      void syncProfiles();
    });
  }, [syncProfiles]);

  const runProfiles = useCallback(async (targetProfiles: FitnessProfile[]) => {
    if (targetProfiles.length === 0) {
      return;
    }

    if (!hasContext) {
      const message = "请先在上方选择 Workspace 与 Repository";
      setGlobalError(message);
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of targetProfiles) {
          next[profile] = {
            ...next[profile],
            state: "error",
            source: "analysis",
            error: message,
          };
        }
        return next;
      });
      return;
    }

    setGlobalError(null);
    setProfiles((current) => {
      const next = { ...current };
      for (const profile of targetProfiles) {
        const pendingArgs = buildFluencyCommandArgs(profile, runMode, compareLast, noSave);
        next[profile] = {
          ...next[profile],
          state: "loading",
          error: undefined,
          updatedAt: new Date().toLocaleString(),
          console: {
            command: "cargo",
            args: pendingArgs,
            stdout: "",
            stderr: "",
            data: `$ cargo ${pendingArgs.join(" ")}\n\n[running fluency analysis...]\n[note] This command does not stream step-by-step logs. On success it emits one final JSON report to stdout.\n`,
          },
        };
      }
      return next;
    });

    try {
      const response = await desktopAwareFetch("/api/fitness/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profiles: targetProfiles,
          compareLast,
          noSave,
          ...contextPayload,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const message = `执行失败: ${response.status} ${body || "空响应"}`;
        setGlobalError(message);
        setProfiles((current) => {
          const next = { ...current };
          for (const profile of targetProfiles) {
            next[profile] = {
              state: "error",
              source: "analysis",
              error: message,
            };
          }
          return next;
        });
        return;
      }

      const payload: AnalyzeResponse = await response.json().catch(() => ({
        generatedAt: new Date().toISOString(),
        requestedProfiles: targetProfiles,
        profiles: [],
      }));

      applyProfiles(normalizeApiResponse(payload));
      setLastSnapshotAt(payload.generatedAt);
    } catch (error) {
      const message = `执行失败: ${toMessage(error)}`;
      setGlobalError(message);
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of targetProfiles) {
          next[profile] = {
            state: "error",
            source: "analysis",
            error: message,
          };
        }
        return next;
      });
    }
  }, [applyProfiles, compareLast, contextPayload, hasContext, noSave, runMode]);

  const onRunSelectedProfile = useCallback(() => {
    setViewMode("overview");
    void runProfiles([selectedProfile]);
  }, [runProfiles, selectedProfile]);

  const onRunAllProfiles = useCallback(() => {
    setViewMode("overview");
    void runProfiles([...PROFILE_ORDER]);
  }, [runProfiles]);

  const selectedDef = PROFILE_DEFS.find((item) => item.id === selectedProfile) ?? PROFILE_DEFS[0];
  const selectedReport = selectedState.report;
  const peerReport = peerState.report;
  const blockers = selectedReport?.blockingCriteria ?? [];
  const failedCriteria = selectedReport?.criteria.filter((criterion) => criterion.status === "fail") ?? [];
  const peerDelta = useMemo(() => {
    if (!selectedReport || !peerReport) {
      return null;
    }

    return clampPercent(selectedReport.currentLevelReadiness) - clampPercent(peerReport.currentLevelReadiness);
  }, [peerReport, selectedReport]);

  const primaryViews = VIEW_MODES.filter((mode) => mode.id !== "console" && mode.id !== "raw");
  const advancedViews = VIEW_MODES.filter((mode) => mode.id === "console" || mode.id === "raw");
  const heroModel = buildHeroModel(selectedReport, selectedProfile, selectedState.state);
  const primaryActionLabel = buildPrimaryActionLabel(selectedReport, selectedState.state);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <SurfaceCard title="Report Controls">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
              Repository Context
            </div>
            <div className="mt-2 text-sm font-semibold text-desktop-text-primary">{contextLabel ?? "未设置 Repository"}</div>
            <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">
              先确认 profile 和 mode，再运行分析。首屏会优先显示当前结论、阻塞原因和下一步动作。
            </p>
          </div>

          <div className="mt-3 space-y-3">
            {PROFILE_DEFS.map((profile) => {
              const state = profiles[profile.id];
              const report = state.report;
              const active = profile.id === selectedProfile;
              const score = clampPercent(report?.currentLevelReadiness ?? 0);

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfile(profile.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? "border-desktop-accent bg-desktop-bg-primary shadow-sm"
                      : "border-desktop-border bg-white/70 hover:bg-desktop-bg-primary/80 dark:bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-desktop-text-primary">{profile.name}</div>
                      <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{profile.description}</div>
                    </div>
                    <StatusBadge state={state.state} />
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-desktop-bg-secondary">
                    <div className={`h-full rounded-full ${readinessBarTone(report?.currentLevelReadiness ?? 0)}`} style={{ width: `${score}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-desktop-text-secondary">
                    <span>{report?.overallLevelName ?? "尚无结果"}</span>
                    <span>{report ? `${score}% 置信度` : "等待分析"}</span>
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{profile.focus}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Mode</div>
            <div className="mt-2 space-y-2">
              {FLUENCY_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setRunMode(mode.id)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    runMode === mode.id
                      ? "border-desktop-accent bg-desktop-bg-primary"
                      : "border-desktop-border bg-white/70 hover:bg-desktop-bg-primary/80 dark:bg-white/5"
                  }`}
                >
                  <div className="text-sm font-semibold text-desktop-text-primary">{mode.label}</div>
                  <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{mode.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={onRunSelectedProfile}
              disabled={!hasContext || selectedState.state === "loading"}
              className="w-full rounded-full bg-desktop-accent px-4 py-2 text-sm font-semibold text-desktop-text-on-accent disabled:opacity-60"
            >
              {primaryActionLabel}
            </button>
            <button
              type="button"
              onClick={onRunAllProfiles}
              disabled={!hasContext || profiles.generic.state === "loading" || profiles.agent_orchestrator.state === "loading"}
              className="w-full rounded-full border border-desktop-border px-4 py-2 text-sm font-semibold text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
            >
              Run both profiles
            </button>
            <button
              type="button"
              onClick={() => void syncProfiles()}
              disabled={!hasContext}
              className="w-full rounded-full border border-desktop-border px-4 py-2 text-sm font-semibold text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
            >
              Refresh latest report
            </button>
          </div>

          <div className="mt-4 space-y-2 text-[11px] text-desktop-text-secondary">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={compareLast}
                onChange={(event) => setCompareLast(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-desktop-accent"
              />
              附带与上次对比结果
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={noSave}
                onChange={(event) => setNoSave(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-desktop-accent"
              />
              本次运行不写入快照
            </label>
          </div>

          <div className="mt-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
            {lastSnapshotAt ? `最近快照：${formatTime(lastSnapshotAt)}` : "尚未读取到快照"}
          </div>

          {globalError ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-[11px] leading-5 text-rose-700">
              {globalError}
            </div>
          ) : null}
        </SurfaceCard>

        <SurfaceCard title="Views">
          <div className="space-y-2">
            {primaryViews.map((mode) => (
              <ViewButton
                key={mode.id}
                active={viewMode === mode.id}
                label={mode.label}
                description={mode.description}
                onClick={() => setViewMode(mode.id)}
              />
            ))}
          </div>

          <div className="mt-4 border-t border-desktop-border pt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
              Advanced Debug
            </div>
            <div className="mt-2 space-y-2">
              {advancedViews.map((mode) => (
                <ViewButton
                  key={mode.id}
                  active={viewMode === mode.id}
                  label={mode.label}
                  description={mode.description}
                  onClick={() => setViewMode(mode.id)}
                />
              ))}
            </div>
          </div>
        </SurfaceCard>
      </aside>

      <div className="space-y-4">
        <section className="rounded-[28px] border border-desktop-border bg-desktop-bg-secondary/60 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {selectedDef.name}
              </div>
              <h3 className="mt-1 text-2xl font-semibold text-desktop-text-primary">
                {heroModel.title}
              </h3>
              <p className="mt-2 text-[12px] leading-6 text-desktop-text-secondary">
                {heroModel.subtitle}
              </p>
            </div>
            <StatusBadge state={selectedState.state} />
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="rounded-3xl border border-desktop-border bg-white/80 p-5 dark:bg-white/6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
                    Current Readiness
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-desktop-text-primary">
                    {heroModel.currentLevel}
                  </div>
                </div>
                <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-1.5 text-[11px] text-desktop-text-secondary">
                  Target: <span className="font-semibold text-desktop-text-primary">{heroModel.targetLevel}</span>
                </div>
              </div>
              <p className="mt-4 text-[13px] leading-6 text-desktop-text-secondary">
                {heroModel.capabilitySummary}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-2 text-[11px] text-desktop-text-secondary">
                  {heroModel.confidenceSummary}
                </div>
                <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-2 text-[11px] text-desktop-text-secondary">
                  {selectedState.source === "analysis" ? "Live analysis" : selectedState.source === "snapshot" ? "Snapshot report" : "No report"}
                </div>
                <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-2 text-[11px] text-desktop-text-secondary">
                  {selectedState.updatedAt ? `Updated ${formatTime(selectedState.updatedAt)}` : "Not generated yet"}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <SummaryMetric
                label="Blockers to clear"
                value={selectedReport ? String(blockers.length) : "N/A"}
                detail={selectedReport
                  ? blockers.length > 0
                    ? `当前还差 ${blockers.length} 个 blocker 才能继续往下一个 level 推进。`
                    : "当前没有 blocker，说明这个 profile 暂时没有关键卡点。"
                  : "先生成报告才能识别 blocker。"}
              />
              <SummaryMetric
                label="Failed criteria"
                value={selectedReport ? String(failedCriteria.length) : "N/A"}
                detail={selectedReport
                  ? "失败项会决定哪些 remediation 应该先做。"
                  : "没有报告时不会生成 remediation 清单。"}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              结果来源:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedState.source === "analysis" ? "本次运行" : selectedState.source === "snapshot" ? "已有快照" : "尚无结果"}
              </span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              当前模式:
              <span className="ml-1 font-semibold text-desktop-text-primary">{selectedReport?.mode ?? runMode}</span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              最近更新时间:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedState.updatedAt ? formatTime(selectedState.updatedAt) : "尚未更新"}
              </span>
            </div>
            <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
              执行耗时:
              <span className="ml-1 font-semibold text-desktop-text-primary">
                {selectedState.durationMs === undefined ? "未记录" : formatDuration(selectedState.durationMs)}
              </span>
            </div>
            {peerDelta !== null ? (
              <div className="rounded-full border border-desktop-border bg-white/80 px-3 py-2 text-[11px] text-desktop-text-secondary dark:bg-white/6">
                相对另一 profile:
                <span className="ml-1 font-semibold text-desktop-text-primary">
                  {peerDelta >= 0 ? "+" : ""}
                  {peerDelta}%
                </span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-desktop-border bg-desktop-bg-secondary/60 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Result Detail</div>
              <p className="mt-1 text-[12px] text-desktop-text-secondary">
                主视图优先看结论和动作；只有在排查执行或序列化问题时，再切到高级调试视图。
              </p>
            </div>
            {viewMode === "console" || viewMode === "raw" ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                Advanced Debug
              </span>
            ) : null}
          </div>

          <div className="mt-4">
            <FitnessAnalysisContent
              selectedProfile={selectedProfile}
              viewMode={viewMode}
              profileState={selectedState}
              report={selectedReport}
              peerReport={peerReport}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
