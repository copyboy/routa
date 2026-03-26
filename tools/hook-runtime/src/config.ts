export const DEFAULT_PRE_PUSH_METRICS = [
  "eslint_pass",
  "ts_typecheck_pass",
  "ts_test_pass",
  "clippy_pass",
  "rust_test_pass",
] as const;

export const DEFAULT_PRE_COMMIT_METRICS = ["eslint_pass"] as const;
export const DEFAULT_LOCAL_VALIDATE_METRICS = [...DEFAULT_PRE_PUSH_METRICS] as const;

export type HookProfileName = "pre-push" | "pre-commit" | "local-validate";

export const HOOK_PROFILE_PRE_PUSH: HookProfileName = "pre-push";
export const HOOK_PROFILE_PRE_COMMIT: HookProfileName = "pre-commit";
export const HOOK_PROFILE_LOCAL_VALIDATE: HookProfileName = "local-validate";

export const PROFILE_DEFAULT: HookProfileName = HOOK_PROFILE_PRE_PUSH;

export function isHookProfileName(value: string | undefined): value is HookProfileName {
  return value === HOOK_PROFILE_PRE_PUSH || value === HOOK_PROFILE_PRE_COMMIT || value === HOOK_PROFILE_LOCAL_VALIDATE;
}

export function resolveProfileDefaults(profile: HookProfileName): readonly string[] {
  if (profile === HOOK_PROFILE_PRE_COMMIT) {
    return [...DEFAULT_PRE_COMMIT_METRICS];
  }
  if (profile === HOOK_PROFILE_LOCAL_VALIDATE) {
    return [...DEFAULT_LOCAL_VALIDATE_METRICS];
  }
  return [...DEFAULT_PRE_PUSH_METRICS];
}

export const DEFAULT_PARALLEL_JOBS = 2;
export const DEFAULT_TAIL_LINES = 10;

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return value;
}

export function parseMetricNames(
  raw: string | undefined,
  fallback: readonly string[] = DEFAULT_PRE_PUSH_METRICS,
): string[] {
  if (!raw) {
    return [...fallback];
  }

  const metrics = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return metrics.length > 0 ? metrics : [...fallback];
}
