"use client";

import { useEffect, useMemo, useState } from "react";

type HookProfileName = string;
type RuntimePhase = string;

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
  configFile: {
    relativePath: string;
    source: string;
    schema?: string;
  } | null;
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

function formatTokenLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

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
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !codebaseId || !repoPath) {
      setHooksState({
        loading: false,
        error: null,
        data: null,
      });
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

  const orderedProfiles = useMemo(() => {
    const profiles = hooksState.data?.profiles ?? [];
    const hookOrder = new Map((hooksState.data?.hookFiles ?? []).map((hook, index) => [hook.name, index]));

    return profiles
      .map((profile, yamlIndex) => {
        const firstBoundHookIndex = profile.hooks
          .map((hookName) => hookOrder.get(hookName))
          .find((index): index is number => typeof index === "number");
        return { profile, yamlIndex, firstBoundHookIndex };
      })
      .sort((left, right) => {
        const leftIsBound = typeof left.firstBoundHookIndex === "number";
        const rightIsBound = typeof right.firstBoundHookIndex === "number";
        if (leftIsBound && rightIsBound) {
          const leftBoundIndex = left.firstBoundHookIndex ?? Number.MAX_SAFE_INTEGER;
          const rightBoundIndex = right.firstBoundHookIndex ?? Number.MAX_SAFE_INTEGER;
          return leftBoundIndex - rightBoundIndex;
        }
        if (leftIsBound) {
          return -1;
        }
        if (rightIsBound) {
          return 1;
        }
        return left.yamlIndex - right.yamlIndex;
      })
      .map(({ profile }) => profile);
  }, [hooksState.data?.hookFiles, hooksState.data?.profiles]);

  const profileEntries = useMemo(
    () => orderedProfiles.map((profile) => ({
      profile,
      hookNames: profile.hooks,
      isBound: profile.hooks.length > 0,
    })),
    [orderedProfiles],
  );

  const defaultSelectableHook = useMemo(
    () => profileEntries[0] ?? null,
    [profileEntries],
  );

  const activeHookName = useMemo(() => {
    if (!defaultSelectableHook) {
      return selectedProfileName ?? "";
    }

    const selectedEntry = profileEntries.find((entry) => entry.profile.name === selectedProfileName);
    if (selectedEntry) {
      return selectedEntry.profile.name;
    }

    return defaultSelectableHook.profile.name;
  }, [defaultSelectableHook, profileEntries, selectedProfileName]);

  const activeHookEntry = useMemo(
    () => profileEntries.find((entry) => entry.profile.name === activeHookName) ?? defaultSelectableHook ?? null,
    [activeHookName, defaultSelectableHook, profileEntries],
  );

  const runtimeProfile = activeHookEntry?.profile ?? null;

  const hookCount = hooksState.data?.hookFiles.length ?? 0;
  const profileCount = hooksState.data?.profiles.length ?? 0;
  const metricCount = hooksState.data?.profiles.reduce((sum, profile) => sum + profile.metrics.length, 0) ?? 0;

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
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

      {!hooksState.loading && !hooksState.error && !hooksState.data?.profiles.length ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          No hook profiles found for the selected repository.
        </div>
      ) : null}

      {hooksState.data ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Profiles</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Configured profiles</h4>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {profileEntries.length} profiles
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              {profileEntries.map((entry) => {
                const isSelected = activeHookEntry?.profile.name === entry.profile.name;
                const profile = entry.profile;
                return (
                  <button
                    key={entry.profile.name}
                    type="button"
                    onClick={() => {
                      setSelectedProfileName(entry.profile.name);
                    }}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "border-desktop-accent bg-desktop-bg-secondary text-desktop-text-primary"
                        : !entry.isBound
                          ? "border-desktop-border bg-desktop-bg-primary/60 text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                          : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold">{profile.name}</div>
                        <div className="mt-1 text-[10px]">
                          {profile.phases.length} phases · {profile.metrics.length} metrics
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        entry.isBound
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary/60"
                      }`}>
                        {entry.isBound ? `${entry.hookNames.length} hooks` : "unbound"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                      {profile.phases.slice(0, 3).map((phase) => (
                        <span
                          key={`${entry.profile.name}-${phase}`}
                          className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5"
                        >
                          {formatTokenLabel(phase)}
                        </span>
                      ))}
                    </div>
                    {!entry.isBound ? (
                      <div className="mt-2 text-[10px] text-desktop-text-secondary/60">
                        Configured in `hooks.yaml`, but not wired by any checked-in git hook file.
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            {runtimeProfile ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Selected profile</div>
                    <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{runtimeProfile.name}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    {activeHookEntry?.hookNames.length ? (
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                        {activeHookEntry.hookNames.join(", ")}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {runtimeProfile.phases.length} phases
                    </span>
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {runtimeProfile.fallbackMetrics.length} metrics
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Mapped metrics</div>
                          <div className="mt-1 text-[11px] text-desktop-text-secondary">
                            Configured metrics resolved from `docs/fitness/manifest.yaml`
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
              </>
            ) : (
              <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
                No runtime profiles found for the selected repository.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
