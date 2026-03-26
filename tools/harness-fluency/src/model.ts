import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load as loadYaml } from "js-yaml";

const BUNDLED_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const DEFAULT_PROFILE = "generic";
export type FluencyProfileName = "generic" | "agent_orchestrator";
export const DEFAULT_MODEL_RELATIVE_PATH = path.join("docs", "fitness", "harness-fluency.model.yaml");
export const DEFAULT_SNAPSHOT_RELATIVE_PATH = path.join("docs", "fitness", "reports", "harness-fluency-latest.json");
export const CELL_PASS_THRESHOLD = 0.8;
export const MAX_REGEX_PATTERN_LENGTH = 256;
export const MAX_REGEX_INPUT_LENGTH = 20_000;

const PROFILE_ALIASES: Record<string, FluencyProfileName> = {
  orchestrator: "agent_orchestrator",
};

const PROFILE_MODEL_RELATIVE_PATHS: Record<FluencyProfileName, string> = {
  generic: DEFAULT_MODEL_RELATIVE_PATH,
  agent_orchestrator: path.join("docs", "fitness", "harness-fluency.profile.agent_orchestrator.yaml"),
};

export type OutputFormat = "text" | "json";
export type CriterionStatus = "pass" | "fail" | "skipped";
type PathSegment = string | number;
type PathSpec = readonly PathSegment[];

export type FluencyLevel = { id: string; name: string };
export type FluencyDimension = { id: string; name: string };

type FileExistsDetector = { type: "file_exists"; path: string };
type FileContainsRegexDetector = {
  type: "file_contains_regex";
  path: string;
  pattern: string;
  flags: string;
};
type AnyOfDetector = { type: "any_of"; detectors: readonly DetectorDefinition[] };
type AnyFileExistsDetector = { type: "any_file_exists"; paths: readonly string[] };
type GlobCountDetector = { type: "glob_count"; patterns: readonly string[]; min: number };
type GlobContainsRegexDetector = {
  type: "glob_contains_regex";
  patterns: readonly string[];
  pattern: string;
  flags: string;
  minMatches: number;
};
type JsonPathExistsDetector = { type: "json_path_exists"; path: string; jsonPath: PathSpec };
type YamlPathExistsDetector = { type: "yaml_path_exists"; path: string; yamlPath: PathSpec };
type CommandExitCodeDetector = {
  type: "command_exit_code";
  command: string;
  expectedExitCode: number;
  timeoutMs: number;
};
type CommandOutputRegexDetector = {
  type: "command_output_regex";
  command: string;
  pattern: string;
  flags: string;
  expectedExitCode: number;
  timeoutMs: number;
};
type ManualAttestationDetector = { type: "manual_attestation"; prompt: string };

export type DetectorDefinition =
  | FileExistsDetector
  | FileContainsRegexDetector
  | AnyOfDetector
  | AnyFileExistsDetector
  | GlobCountDetector
  | GlobContainsRegexDetector
  | JsonPathExistsDetector
  | YamlPathExistsDetector
  | CommandExitCodeDetector
  | CommandOutputRegexDetector
  | ManualAttestationDetector;

export type FluencyCriterion = {
  id: string;
  level: string;
  dimension: string;
  weight: number;
  critical: boolean;
  whyItMatters: string;
  recommendedAction: string;
  evidenceHint: string;
  detector: DetectorDefinition;
};

export type FluencyModel = {
  version: number;
  levels: readonly FluencyLevel[];
  dimensions: readonly FluencyDimension[];
  criteria: readonly FluencyCriterion[];
};

export type CriterionResult = {
  id: string;
  level: string;
  dimension: string;
  weight: number;
  critical: boolean;
  status: CriterionStatus;
  detectorType: DetectorDefinition["type"];
  detail: string;
  evidence: readonly string[];
  whyItMatters: string;
  recommendedAction: string;
  evidenceHint: string;
};

export type CellResult = {
  id: string;
  level: string;
  levelName: string;
  dimension: string;
  dimensionName: string;
  score: number;
  passed: boolean;
  passedWeight: number;
  applicableWeight: number;
  criteria: readonly CriterionResult[];
};

export type DimensionResult = {
  dimension: string;
  name: string;
  level: string;
  levelName: string;
  levelIndex: number;
  score: number;
  nextLevel: string | null;
  nextLevelName: string | null;
  nextLevelProgress: number | null;
};

export type Recommendation = {
  criterionId: string;
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
  weight: number;
};

export type ReportComparison = {
  previousGeneratedAt: string;
  previousOverallLevel: string;
  overallChange: "same" | "up" | "down";
  dimensionChanges: Array<{
    dimension: string;
    previousLevel: string;
    currentLevel: string;
    change: "same" | "up" | "down";
  }>;
  criteriaChanges: Array<{
    id: string;
    previousStatus: CriterionStatus | null;
    currentStatus: CriterionStatus | null;
  }>;
};

export type HarnessFluencyReport = {
  modelVersion: number;
  modelPath: string;
  profile: FluencyProfileName;
  repoRoot: string;
  generatedAt: string;
  snapshotPath: string;
  overallLevel: string;
  overallLevelName: string;
  nextLevel: string | null;
  nextLevelName: string | null;
  nextLevelReadiness: number | null;
  dimensions: Record<string, DimensionResult>;
  cells: readonly CellResult[];
  criteria: readonly CriterionResult[];
  blockingCriteria: readonly CriterionResult[];
  recommendations: readonly Recommendation[];
  comparison: ReportComparison | null;
};

export type EvaluateOptions = {
  repoRoot: string;
  modelPath: string;
  profile?: FluencyProfileName;
  snapshotPath: string;
  compareLast: boolean;
  save: boolean;
};

export type CliOptions = {
  repoRoot: string;
  modelPath: string;
  profile: FluencyProfileName;
  snapshotPath: string;
  format: OutputFormat;
  compareLast: boolean;
  save: boolean;
  help: boolean;
};

export const DETERMINISTIC_PRIORITY: Record<DetectorDefinition["type"], number> = {
  file_exists: 0,
  file_contains_regex: 0,
  any_of: 0,
  any_file_exists: 0,
  glob_count: 0,
  glob_contains_regex: 0,
  json_path_exists: 0,
  yaml_path_exists: 0,
  command_exit_code: 0,
  command_output_regex: 0,
  manual_attestation: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function expectBoolean(value: unknown, label: string, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

export function isFluencyProfileName(value: string): value is FluencyProfileName {
  return value === "generic" || value === "agent_orchestrator";
}

export function normalizeProfileName(value: string): FluencyProfileName {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const resolved = PROFILE_ALIASES[normalized] ?? normalized;
  if (!isFluencyProfileName(resolved)) {
    throw new Error(`unsupported profile "${value}"`);
  }
  return resolved;
}

function profilePathForRepo(repoRoot: string, profile: FluencyProfileName): string {
  return path.resolve(repoRoot, PROFILE_MODEL_RELATIVE_PATHS[profile]);
}

function bundledProfilePath(profile: FluencyProfileName): string {
  return path.resolve(BUNDLED_REPO_ROOT, PROFILE_MODEL_RELATIVE_PATHS[profile]);
}

function profileSnapshotFilename(profile: FluencyProfileName): string {
  if (profile === "generic") {
    return path.basename(DEFAULT_SNAPSHOT_RELATIVE_PATH);
  }

  return `harness-fluency-${profile.replace(/_/g, "-")}-latest.json`;
}

export function resolveDefaultModelPath(repoRoot: string, profile: FluencyProfileName): string {
  const repoPath = profilePathForRepo(repoRoot, profile);
  if (existsSync(repoPath)) {
    return repoPath;
  }

  return bundledProfilePath(profile);
}

export function resolveDefaultSnapshotPath(repoRoot: string, profile: FluencyProfileName): string {
  return path.resolve(repoRoot, "docs", "fitness", "reports", profileSnapshotFilename(profile));
}

function expectNumber(value: unknown, label: string, defaultValue?: number): number {
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`${label} must be a number`);
    }
    return defaultValue;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function parsePathSpec(value: unknown, label: string): PathSpec {
  if (typeof value === "string") {
    return value
      .split(".")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty path array or dotted string`);
  }

  return value.map((segment) => {
    if (typeof segment === "string" && segment.length > 0) {
      return segment;
    }
    if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0) {
      return segment;
    }
    throw new Error(`${label} contains an invalid segment`);
  });
}

function parseStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  return value.map((item, index) => expectString(item, `${label}[${index}]`));
}

function parseRegexSettings(
  detector: Record<string, unknown>,
  label: string,
  defaultFlags = "i",
): { pattern: string; flags: string } {
  const pattern = expectString(detector.pattern, `${label}.pattern`);
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(`${label}.pattern exceeds max length ${MAX_REGEX_PATTERN_LENGTH}`);
  }

  const flags = typeof detector.flags === "string" ? detector.flags : defaultFlags;
  try {
    void new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(
      `${label} has invalid regex settings: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return { pattern, flags };
}

function parseDetector(value: unknown, label: string): DetectorDefinition {
  const detector = expectRecord(value, label);
  const type = expectString(detector.type, `${label}.type`);

  switch (type) {
    case "file_exists":
      return { type, path: expectString(detector.path, `${label}.path`) };
    case "file_contains_regex": {
      const { pattern, flags } = parseRegexSettings(detector, label);
      return {
        type,
        path: expectString(detector.path, `${label}.path`),
        pattern,
        flags,
      };
    }
    case "any_of": {
      const nested = detector.detectors;
      if (!Array.isArray(nested) || nested.length === 0) {
        throw new Error(`${label}.detectors must be a non-empty array`);
      }

      return {
        type,
        detectors: nested.map((item, index) => parseDetector(item, `${label}.detectors[${index}]`)),
      };
    }
    case "any_file_exists":
      return { type, paths: parseStringArray(detector.paths, `${label}.paths`) };
    case "glob_count":
      return {
        type,
        patterns: Array.isArray(detector.patterns)
          ? parseStringArray(detector.patterns, `${label}.patterns`)
          : [expectString(detector.pattern, `${label}.pattern`)],
        min: expectNumber(detector.min, `${label}.min`, 1),
      };
    case "glob_contains_regex": {
      const { pattern, flags } = parseRegexSettings(detector, label);
      return {
        type,
        patterns: Array.isArray(detector.patterns)
          ? parseStringArray(detector.patterns, `${label}.patterns`)
          : [expectString(detector.pattern_glob, `${label}.pattern_glob`)],
        pattern,
        flags,
        minMatches: expectNumber(detector.minMatches, `${label}.minMatches`, 1),
      };
    }
    case "json_path_exists":
      return {
        type,
        path: expectString(detector.path, `${label}.path`),
        jsonPath: parsePathSpec(detector.jsonPath, `${label}.jsonPath`),
      };
    case "yaml_path_exists":
      return {
        type,
        path: expectString(detector.path, `${label}.path`),
        yamlPath: parsePathSpec(detector.yamlPath, `${label}.yamlPath`),
      };
    case "command_exit_code":
      return {
        type,
        command: expectString(detector.command, `${label}.command`),
        expectedExitCode: expectNumber(detector.expectedExitCode, `${label}.expectedExitCode`, 0),
        timeoutMs: expectNumber(detector.timeoutMs, `${label}.timeoutMs`, 10_000),
      };
    case "command_output_regex": {
      const { pattern, flags } = parseRegexSettings(detector, label);

      return {
        type,
        command: expectString(detector.command, `${label}.command`),
        pattern,
        flags,
        expectedExitCode: expectNumber(detector.expectedExitCode, `${label}.expectedExitCode`, 0),
        timeoutMs: expectNumber(detector.timeoutMs, `${label}.timeoutMs`, 10_000),
      };
    }
    case "manual_attestation":
      return { type, prompt: expectString(detector.prompt, `${label}.prompt`) };
    default:
      throw new Error(`${label}.type "${type}" is not supported`);
  }
}

async function loadRawFluencyModel(modelPath: string, visited: Set<string>): Promise<Record<string, unknown>> {
  const resolvedModelPath = path.resolve(modelPath);
  if (visited.has(resolvedModelPath)) {
    throw new Error(`cyclic harness fluency model extends detected at ${resolvedModelPath}`);
  }

  visited.add(resolvedModelPath);
  const rawContent = await readFile(resolvedModelPath, "utf8");
  const rawModel = expectRecord(loadYaml(rawContent), "harness fluency model");
  const extendsPath = rawModel.extends;
  if (extendsPath === undefined) {
    visited.delete(resolvedModelPath);
    return rawModel;
  }

  const baseModelPath = path.resolve(path.dirname(resolvedModelPath), expectString(extendsPath, "model.extends"));
  const baseModel = await loadRawFluencyModel(baseModelPath, visited);
  visited.delete(resolvedModelPath);

  const mergedModel: Record<string, unknown> = {
    ...baseModel,
    ...rawModel,
  };
  delete mergedModel.extends;

  if (rawModel.criteria === undefined) {
    mergedModel.criteria = baseModel.criteria;
    return mergedModel;
  }

  if (!Array.isArray(rawModel.criteria)) {
    throw new Error("model.criteria must be an array");
  }

  if (!Array.isArray(baseModel.criteria)) {
    throw new Error("base model.criteria must be an array");
  }

  mergedModel.criteria = [...baseModel.criteria, ...rawModel.criteria];
  return mergedModel;
}

export async function loadFluencyModel(modelPath: string): Promise<FluencyModel> {
  const rawModel = await loadRawFluencyModel(modelPath, new Set());

  const levelsRaw = rawModel.levels;
  if (!Array.isArray(levelsRaw) || levelsRaw.length === 0) {
    throw new Error("harness fluency model.levels must be a non-empty array");
  }
  const levels = levelsRaw.map((entry, index) => {
    const record = expectRecord(entry, `levels[${index}]`);
    return {
      id: expectString(record.id, `levels[${index}].id`),
      name: expectString(record.name, `levels[${index}].name`),
    };
  });

  const dimensionsRaw = rawModel.dimensions;
  if (!Array.isArray(dimensionsRaw) || dimensionsRaw.length === 0) {
    throw new Error("harness fluency model.dimensions must be a non-empty array");
  }
  const dimensions = dimensionsRaw.map((entry, index) => {
    const record = expectRecord(entry, `dimensions[${index}]`);
    return {
      id: expectString(record.id, `dimensions[${index}].id`),
      name: expectString(record.name, `dimensions[${index}].name`),
    };
  });

  const levelIds = new Set(levels.map((level) => level.id));
  const dimensionIds = new Set(dimensions.map((dimension) => dimension.id));
  if (levelIds.size !== levels.length) {
    throw new Error("harness fluency model.levels contains duplicate ids");
  }
  if (dimensionIds.size !== dimensions.length) {
    throw new Error("harness fluency model.dimensions contains duplicate ids");
  }

  const criteriaRaw = rawModel.criteria;
  if (!Array.isArray(criteriaRaw) || criteriaRaw.length === 0) {
    throw new Error("harness fluency model.criteria must be a non-empty array");
  }
  const criteria = criteriaRaw.map((entry, index) => {
    const record = expectRecord(entry, `criteria[${index}]`);
    const level = expectString(record.level, `criteria[${index}].level`);
    const dimension = expectString(record.dimension, `criteria[${index}].dimension`);

    if (!levelIds.has(level)) {
      throw new Error(`criteria[${index}].level references unknown level "${level}"`);
    }
    if (!dimensionIds.has(dimension)) {
      throw new Error(`criteria[${index}].dimension references unknown dimension "${dimension}"`);
    }

    return {
      id: expectString(record.id, `criteria[${index}].id`),
      level,
      dimension,
      weight: expectNumber(record.weight, `criteria[${index}].weight`, 1),
      critical: expectBoolean(record.critical, `criteria[${index}].critical`, false),
      whyItMatters: expectString(record.why_it_matters, `criteria[${index}].why_it_matters`),
      recommendedAction: expectString(record.recommended_action, `criteria[${index}].recommended_action`),
      evidenceHint: expectString(record.evidence_hint, `criteria[${index}].evidence_hint`),
      detector: parseDetector(record.detector, `criteria[${index}].detector`),
    } satisfies FluencyCriterion;
  });

  const criterionIds = new Set(criteria.map((criterion) => criterion.id));
  if (criterionIds.size !== criteria.length) {
    throw new Error("harness fluency model.criteria contains duplicate ids");
  }

  for (const level of levels) {
    for (const dimension of dimensions) {
      const count = criteria.filter(
        (criterion) => criterion.level === level.id && criterion.dimension === dimension.id,
      ).length;
      if (count < 2) {
        throw new Error(`cell ${dimension.id} × ${level.id} must declare at least 2 criteria`);
      }
    }
  }

  return {
    version: expectNumber(rawModel.version, "model.version", 1),
    levels,
    dimensions,
    criteria,
  };
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const normalizedArgv = argv[0] === "fluency" || argv[0] === "run" ? argv.slice(1) : argv;
  const repoRoot = process.cwd();
  const options: CliOptions = {
    repoRoot,
    modelPath: resolveDefaultModelPath(repoRoot, DEFAULT_PROFILE),
    profile: DEFAULT_PROFILE,
    snapshotPath: resolveDefaultSnapshotPath(repoRoot, DEFAULT_PROFILE),
    format: "text",
    compareLast: false,
    save: true,
    help: false,
  };
  let hasExplicitModel = false;
  let hasExplicitSnapshotPath = false;

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--compare-last") {
      options.compareLast = true;
      continue;
    }
    if (arg === "--json") {
      options.format = "json";
      continue;
    }
    if (arg === "--no-save") {
      options.save = false;
      continue;
    }
    if (
      (
        arg === "--format" ||
        arg === "--repo-root" ||
        arg === "--model" ||
        arg === "--profile" ||
        arg === "--snapshot-path"
      ) &&
      index + 1 < normalizedArgv.length
    ) {
      const value = normalizedArgv[index + 1];
      if (arg === "--format") {
        if (value !== "text" && value !== "json") {
          throw new Error(`unsupported format "${value}"`);
        }
        options.format = value;
      } else if (arg === "--repo-root") {
        options.repoRoot = path.resolve(value);
        if (!hasExplicitModel) {
          options.modelPath = resolveDefaultModelPath(options.repoRoot, options.profile);
        }
        if (!hasExplicitSnapshotPath) {
          options.snapshotPath = resolveDefaultSnapshotPath(options.repoRoot, options.profile);
        }
      } else if (arg === "--model") {
        options.modelPath = path.resolve(value);
        hasExplicitModel = true;
      } else if (arg === "--profile") {
        options.profile = normalizeProfileName(value);
        if (!hasExplicitModel) {
          options.modelPath = resolveDefaultModelPath(options.repoRoot, options.profile);
        }
        if (!hasExplicitSnapshotPath) {
          options.snapshotPath = resolveDefaultSnapshotPath(options.repoRoot, options.profile);
        }
      } else if (arg === "--snapshot-path") {
        options.snapshotPath = path.resolve(value);
        hasExplicitSnapshotPath = true;
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument "${arg}"`);
  }

  return options;
}

export function renderHelp(): string {
  return [
    "Usage: node --import tsx tools/harness-fluency/src/cli.ts [options]",
    "",
    "Options:",
    "  --format <text|json>     Output format",
    "  --json                   Shortcut for --format json",
    "  --profile <name>         Built-in model profile (generic, agent_orchestrator)",
    "  --repo-root <path>       Repository root to evaluate",
    "  --model <path>           Override model YAML path",
    "  --snapshot-path <path>   Override persisted snapshot path",
    "  --compare-last           Compare against the last saved snapshot",
    "  --no-save                Do not persist the current snapshot",
    "  -h, --help               Show help",
  ].join("\n");
}
