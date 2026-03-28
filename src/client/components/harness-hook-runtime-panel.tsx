"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";

type HookProfileName = "pre-push" | "pre-commit" | "local-validate";
type RuntimePhase = "submodule" | "fitness" | "fitness-fast" | "review";

type HookMetricSummary = {
  name: string;
  command: string;
  description: string;
  hardGate: boolean;
  resolved: boolean;
  sourceFile?: string;
};

type HookRuntimeProfileSummary = {
  name: HookProfileName;
  phases: RuntimePhase[];
  fallbackMetrics: string[];
  metrics: HookMetricSummary[];
  hooks: string[];
};

type HookFileSummary = {
  name: string;
  relativePath: string;
  source: string;
  triggerCommand: string;
  kind: "runtime-profile" | "shell-command";
  runtimeProfileName?: HookProfileName;
  skipEnvVar?: string;
};

type HooksResponse = {
  generatedAt: string;
  repoRoot: string;
  hooksDir: string;
  hookFiles: HookFileSummary[];
  profiles: HookRuntimeProfileSummary[];
  warnings: string[];
};

type HooksPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
};

type HooksState = {
  loading: boolean;
  error: string | null;
  data: HooksResponse | null;
};

type PreviewMode = "dry-run" | "live";

type PhasePreview = {
  phase: RuntimePhase;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  reason?: string;
  message?: string;
  metrics?: string[];
};

type MetricPreview = {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  exitCode?: number;
  command?: string;
  sourceFile?: string;
  outputTail?: string;
};

type HookPreviewResponse = {
  generatedAt: string;
  repoRoot: string;
  profile: HookProfileName;
  mode: PreviewMode;
  ok: boolean;
  exitCode: number;
  command: string[];
  phaseResults: PhasePreview[];
  metricResults: MetricPreview[];
  eventSample: Record<string, unknown>[];
  stderr: string;
};

type PreviewState = {
  loading: boolean;
  error: string | null;
  data: HookPreviewResponse | null;
  mode: PreviewMode;
};

const PHASE_LABELS: Record<RuntimePhase, string> = {
  submodule: "Submodule",
  fitness: "Fitness",
  "fitness-fast": "Fitness Fast",
  review: "Review",
};

export function HarnessHookRuntimePanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
}: HooksPanelProps) {
  const [hooksState, setHooksState] = useState<HooksState>({
    loading: false,
    error: null,
    data: null,
  });
  const [selectedHookName, setSelectedHookName] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>({
    loading: false,
    error: null,
    data: null,
    mode: "dry-run",
  });

  useEffect(() => {
    if (!workspaceId || !codebaseId || !repoPath) {
      setHooksState({
        loading: false,
        error: null,
        data: null,
      });
      setSelectedHookName("");
      return;
    }

    let cancelled = false;
    const fetchHooks = async () => {
      setHooksState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        query.set("codebaseId", codebaseId);
        query.set("repoPath", repoPath);

        const response = await fetch(`/api/harness/hooks?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }

        if (cancelled) {
          return;
        }

        setHooksState({
          loading: false,
          error: null,
          data: payload as HooksResponse,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setHooksState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          data: null,
        });
      }
    };

    void fetchHooks();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, codebaseId, repoPath]);

  const visibleHook = useMemo(() => {
    const hookFiles = hooksState.data?.hookFiles ?? [];
    if (hookFiles.length === 0) {
      return null;
    }
    return hookFiles.find((hook) => hook.name === selectedHookName) ?? hookFiles[0] ?? null;
  }, [hooksState.data?.hookFiles, selectedHookName]);

  useEffect(() => {
    if (!visibleHook) {
      if (selectedHookName) {
        setSelectedHookName("");
      }
      return;
    }
    if (visibleHook.name !== selectedHookName) {
      setSelectedHookName(visibleHook.name);
    }
  }, [selectedHookName, visibleHook]);

  const runtimeProfile = useMemo(() => {
    if (!visibleHook?.runtimeProfileName) {
      return null;
    }
    return hooksState.data?.profiles.find((profile) => profile.name === visibleHook.runtimeProfileName) ?? null;
  }, [hooksState.data?.profiles, visibleHook]);

  useEffect(() => {
    if (!workspaceId || !codebaseId || !repoPath || !runtimeProfile) {
      setPreviewState({
        loading: false,
        error: null,
        data: null,
        mode: "dry-run",
      });
      return;
    }

    let cancelled = false;
    const loadPreview = async (mode: PreviewMode) => {
      setPreviewState({
        loading: true,
        error: null,
        data: null,
        mode,
      });

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        query.set("codebaseId", codebaseId);
        query.set("repoPath", repoPath);
        query.set("profile", runtimeProfile.name);
        query.set("mode", mode);

        const response = await fetch(`/api/harness/hooks/preview?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook preview");
        }

        if (cancelled) {
          return;
        }

        setPreviewState({
          loading: false,
          error: null,
          data: payload as HookPreviewResponse,
          mode,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setPreviewState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          data: null,
          mode,
        });
      }
    };

    void loadPreview("dry-run");
    return () => {
      cancelled = true;
    };
  }, [workspaceId, codebaseId, repoPath, runtimeProfile]);

  const runPreview = async (mode: PreviewMode) => {
    if (!workspaceId || !codebaseId || !repoPath || !runtimeProfile) {
      return;
    }

    setPreviewState({
      loading: true,
      error: null,
      data: null,
      mode,
    });

    try {
      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      query.set("codebaseId", codebaseId);
      query.set("repoPath", repoPath);
      query.set("profile", runtimeProfile.name);
      query.set("mode", mode);

      const response = await fetch(`/api/harness/hooks/preview?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook preview");
      }

      setPreviewState({
        loading: false,
        error: null,
        data: payload as HookPreviewResponse,
        mode,
      });
    } catch (error) {
      setPreviewState({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        data: null,
        mode,
      });
    }
  };

  const hookCount = hooksState.data?.hookFiles.length ?? 0;
  const profileCount = hooksState.data?.profiles.length ?? 0;
  const metricCount = hooksState.data?.profiles.reduce((sum, profile) => sum + profile.metrics.length, 0) ?? 0;
  const previewJson = previewState.data ? JSON.stringify(previewState.data.eventSample, null, 2) : "[]";
  const metricOutputTails = previewState.data?.metricResults.filter((metric) => metric.outputTail) ?? [];

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook runtime</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Thin hook trigger {"->"} runtime profile {"->"} phases</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {hookCount} hooks
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {profileCount} runtime profiles
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {metricCount} mapped metrics
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-desktop-text-secondary">
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          Git hook script = trigger only
        </span>
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          Hook runtime = orchestration layer
        </span>
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          Renderer modes = human / jsonl
        </span>
      </div>

      {hooksState.loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading hook runtime...
        </div>
      ) : null}

      {hooksState.error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {hooksState.error}
        </div>
      ) : null}

      {hooksState.data?.warnings.length ? (
        <div className="mt-4 space-y-2">
          {hooksState.data.warnings.map((warning) => (
            <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {!hooksState.loading && !hooksState.error && !hooksState.data?.hookFiles.length ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          No hook files found for the selected repository.
        </div>
      ) : null}

      {hooksState.data?.hookFiles.length ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Triggers</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Git hook files</h4>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {hooksState.data.hookFiles.length} files
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {hooksState.data.hookFiles.map((hook) => (
                <button
                  key={hook.name}
                  type="button"
                  onClick={() => {
                    setSelectedHookName(hook.name);
                  }}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                    visibleHook?.name === hook.name
                      ? "border-desktop-accent bg-desktop-bg-secondary text-desktop-text-primary"
                      : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold">{hook.name}</div>
                      <div className="mt-1 truncate font-mono text-[10px]">{hook.relativePath}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      hook.kind === "runtime-profile"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"
                    }`}>
                      {hook.kind === "runtime-profile" ? "runtime" : "shell"}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-desktop-text-secondary">
                    {hook.runtimeProfileName ? `profile ${hook.runtimeProfileName}` : "custom command"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            {visibleHook ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Selected trigger</div>
                    <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{visibleHook.name}</h4>
                    <div className="mt-2 break-all font-mono text-[11px] text-desktop-text-secondary">{visibleHook.triggerCommand}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {visibleHook.kind}
                    </span>
                    {visibleHook.runtimeProfileName ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                        {visibleHook.runtimeProfileName}
                      </span>
                    ) : null}
                    {visibleHook.skipEnvVar ? (
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                        skip {visibleHook.skipEnvVar}
                      </span>
                    ) : null}
                  </div>
                </div>

                {runtimeProfile ? (
                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Runtime graph</div>
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() => { void runPreview("dry-run"); }}
                          disabled={previewState.loading}
                          className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary transition-colors hover:bg-desktop-bg-secondary disabled:opacity-60"
                        >
                          Dry run preview
                        </button>
                        <button
                          type="button"
                          onClick={() => { void runPreview("live"); }}
                          disabled={previewState.loading}
                          className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary transition-colors hover:bg-desktop-bg-secondary disabled:opacity-60"
                        >
                          Run live preview
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-1 text-desktop-text-primary">
                        {visibleHook.name}
                      </span>
                      <span className="text-desktop-text-secondary">{"->"}</span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                        {runtimeProfile.name}
                      </span>
                      {runtimeProfile.phases.map((phase) => (
                        <span key={phase} className="flex items-center gap-2">
                          <span className="text-desktop-text-secondary">{"->"}</span>
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-1 text-desktop-text-secondary">
                            {PHASE_LABELS[phase]}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 px-4 py-3 text-[11px] leading-5 text-desktop-text-secondary">
                    This hook is not using the shared hook runtime. Visualize it as a direct shell task, or migrate it to a runtime profile if you want phase-level observability.
                  </div>
                )}

                <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Hook source</div>
                  <CodeViewer
                    code={visibleHook.source}
                    filename={visibleHook.name}
                    language="shell"
                    maxHeight="220px"
                    showHeader={false}
                    wordWrap
                  />
                </div>

                {runtimeProfile ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Runtime preview</div>
                          <div className="mt-1 text-[11px] text-desktop-text-secondary">
                            JSONL preview from the actual hook runtime entrypoint
                          </div>
                        </div>
                        {previewState.data ? (
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            <span className={`rounded-full border px-2.5 py-1 ${
                              previewState.data.ok
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                            }`}>
                              {previewState.data.ok ? "ok" : `exit ${previewState.data.exitCode}`}
                            </span>
                            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
                              {previewState.data.mode}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {previewState.loading ? (
                        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-4 text-[11px] text-desktop-text-secondary">
                          Running runtime preview...
                        </div>
                      ) : null}

                      {previewState.error ? (
                        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-[11px] text-red-700">
                          {previewState.error}
                        </div>
                      ) : null}

                      {previewState.data ? (
                        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                          <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Phase status</div>
                            <div className="mt-3 space-y-2">
                              {previewState.data.phaseResults.map((phase) => (
                                <div key={`${phase.phase}-${phase.status}`} className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-[11px] font-semibold text-desktop-text-primary">{PHASE_LABELS[phase.phase]}</div>
                                      <div className="mt-1 text-[10px] text-desktop-text-secondary">{phase.phase}</div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[10px]">
                                      <span className={`rounded-full border px-2.5 py-1 ${
                                        phase.status === "passed"
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                          : phase.status === "failed"
                                            ? "border-red-200 bg-red-50 text-red-700"
                                            : "border-amber-200 bg-amber-50 text-amber-800"
                                      }`}>
                                        {phase.status}
                                      </span>
                                      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
                                        {phase.durationMs}ms
                                      </span>
                                    </div>
                                  </div>
                                  {phase.reason ? (
                                    <div className="mt-2 text-[10px] text-desktop-text-secondary">reason: {phase.reason}</div>
                                  ) : null}
                                  {phase.metrics?.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                                      {phase.metrics.map((metric) => (
                                        <span key={`${phase.phase}-${metric}`} className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                                          {metric}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                  {phase.message ? (
                                    <div className="mt-2 text-[10px] text-desktop-text-secondary">{phase.message}</div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Event sample</div>
                            <div className="mt-2 text-[11px] text-desktop-text-secondary">
                              Recent JSONL events emitted by `hook-runtime`
                            </div>
                            <div className="mt-3">
                              <CodeViewer
                                code={previewJson}
                                filename={`${runtimeProfile.name}.preview.json`}
                                language="json"
                                maxHeight="280px"
                                showHeader={false}
                                wordWrap
                              />
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {previewState.data?.stderr ? (
                        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">stderr</div>
                          <CodeViewer
                            code={previewState.data.stderr}
                            filename={`${runtimeProfile.name}.stderr.txt`}
                            maxHeight="180px"
                            showHeader={false}
                            wordWrap
                          />
                        </div>
                      ) : null}

                      {metricOutputTails.length ? (
                        <div className="mt-4 space-y-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Output tails</div>
                          {metricOutputTails.map((metric) => (
                            <div key={`${metric.name}-${metric.exitCode ?? "tail"}`} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[11px] font-semibold text-desktop-text-primary">{metric.name}</div>
                                <div className="flex flex-wrap gap-2 text-[10px]">
                                  <span className={`rounded-full border px-2.5 py-1 ${
                                    metric.status === "failed"
                                      ? "border-red-200 bg-red-50 text-red-700"
                                      : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"
                                  }`}>
                                    {metric.status}
                                  </span>
                                  {typeof metric.durationMs === "number" ? (
                                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                                      {metric.durationMs}ms
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <CodeViewer
                                code={metric.outputTail ?? ""}
                                filename={`${metric.name}.tail.txt`}
                                maxHeight="220px"
                                showHeader={false}
                                wordWrap
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Phase contract</div>
                      <div className="mt-3 space-y-2">
                        {runtimeProfile.phases.map((phase, index) => (
                          <div key={phase} className="flex items-center gap-3 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px]">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-desktop-border bg-desktop-bg-secondary text-[10px] text-desktop-text-primary">
                              {index + 1}
                            </div>
                            <div>
                              <div className="font-semibold text-desktop-text-primary">{PHASE_LABELS[phase]}</div>
                              <div className="text-desktop-text-secondary">{phase}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Mapped metrics</div>
                          <div className="mt-1 text-[11px] text-desktop-text-secondary">
                            Default profile metrics resolved from `docs/fitness/manifest.yaml`
                          </div>
                        </div>
                        <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                          {runtimeProfile.metrics.length} metrics
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {runtimeProfile.metrics.map((metric) => (
                          <div key={metric.name} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold text-desktop-text-primary">{metric.name}</div>
                                {metric.command ? (
                                  <div className="mt-1 break-all font-mono text-[11px] text-desktop-text-secondary">{metric.command}</div>
                                ) : null}
                                {metric.description ? (
                                  <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{metric.description}</div>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2 text-[10px]">
                                <span className={`rounded-full border px-2.5 py-1 ${
                                  metric.resolved
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-800"
                                }`}>
                                  {metric.resolved ? "resolved" : "unresolved"}
                                </span>
                                {metric.hardGate ? (
                                  <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                                    hard gate
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {metric.sourceFile ? (
                              <div className="mt-3 text-[10px] font-mono text-desktop-text-secondary">{metric.sourceFile}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
