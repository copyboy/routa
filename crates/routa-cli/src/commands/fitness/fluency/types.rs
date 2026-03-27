use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

pub(super) const CELL_PASS_THRESHOLD: f64 = 0.8;
pub(super) const MAX_REGEX_PATTERN_LENGTH: usize = 256;
pub(super) const MAX_REGEX_INPUT_LENGTH: usize = 20_000;
pub(super) const MAX_RECOMMENDATIONS: usize = 5;

pub(super) const ALLOWED_COMMAND_EXECUTABLES: &[&str] = &[
    "cargo", "entrix", "git", "node", "npm", "npx", "pnpm", "python", "python3", "uv",
];

pub(super) const DEFAULT_GLOB_IGNORE: &[&str] = &[
    "**/.git/**",
    "**/.next/**",
    "**/.next-*/**",
    "**/.next-desktop/**",
    "**/_next/**",
    "**/.nuxt/**",
    "**/.pnpm-store/**",
    "**/.pytest_cache/**",
    "**/.routa/**",
    "**/.ruff_cache/**",
    "**/.turbo/**",
    "**/.venv/**",
    "**/__pycache__/**",
    "**/build/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/target/**",
    "**/venv/**",
    "**/vendor/**",
    "**/.worktrees/**",
];

#[derive(Clone, Debug)]
pub struct EvaluateOptions {
    pub repo_root: PathBuf,
    pub model_path: PathBuf,
    pub profile: String,
    pub snapshot_path: PathBuf,
    pub compare_last: bool,
    pub save: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CriterionStatus {
    Pass,
    Fail,
    Skipped,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LevelChange {
    Same,
    Up,
    Down,
}

#[derive(Clone, Debug)]
pub(super) enum DetectorDefinition {
    FileExists {
        path: String,
    },
    FileContainsRegex {
        path: String,
        pattern: String,
        flags: String,
    },
    AnyOf {
        detectors: Vec<DetectorDefinition>,
    },
    AnyFileExists {
        paths: Vec<String>,
    },
    GlobCount {
        patterns: Vec<String>,
        min: usize,
    },
    GlobContainsRegex {
        patterns: Vec<String>,
        pattern: String,
        flags: String,
        min_matches: usize,
    },
    JsonPathExists {
        path: String,
        json_path: Vec<PathSegment>,
    },
    YamlPathExists {
        path: String,
        yaml_path: Vec<PathSegment>,
    },
    CommandExitCode {
        command: String,
        expected_exit_code: i32,
        timeout_ms: u64,
    },
    CommandOutputRegex {
        command: String,
        pattern: String,
        flags: String,
        expected_exit_code: i32,
        timeout_ms: u64,
    },
    ManualAttestation {
        prompt: String,
    },
}

impl DetectorDefinition {
    pub(super) fn detector_type(&self) -> &'static str {
        match self {
            Self::FileExists { .. } => "file_exists",
            Self::FileContainsRegex { .. } => "file_contains_regex",
            Self::AnyOf { .. } => "any_of",
            Self::AnyFileExists { .. } => "any_file_exists",
            Self::GlobCount { .. } => "glob_count",
            Self::GlobContainsRegex { .. } => "glob_contains_regex",
            Self::JsonPathExists { .. } => "json_path_exists",
            Self::YamlPathExists { .. } => "yaml_path_exists",
            Self::CommandExitCode { .. } => "command_exit_code",
            Self::CommandOutputRegex { .. } => "command_output_regex",
            Self::ManualAttestation { .. } => "manual_attestation",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) enum PathSegment {
    Key(String),
    Index(usize),
}

#[derive(Clone, Debug)]
pub(super) struct FluencyLevel {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug)]
pub(super) struct FluencyDimension {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug)]
pub(super) struct FluencyCriterion {
    pub id: String,
    pub level: String,
    pub dimension: String,
    pub weight: u32,
    pub critical: bool,
    pub why_it_matters: String,
    pub recommended_action: String,
    pub evidence_hint: String,
    pub detector: DetectorDefinition,
}

#[derive(Clone, Debug)]
pub(super) struct FluencyModel {
    pub version: u32,
    pub levels: Vec<FluencyLevel>,
    pub dimensions: Vec<FluencyDimension>,
    pub criteria: Vec<FluencyCriterion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionResult {
    pub id: String,
    pub level: String,
    pub dimension: String,
    pub weight: u32,
    pub critical: bool,
    pub status: CriterionStatus,
    pub detector_type: String,
    pub detail: String,
    pub evidence: Vec<String>,
    pub why_it_matters: String,
    pub recommended_action: String,
    pub evidence_hint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellResult {
    pub id: String,
    pub level: String,
    pub level_name: String,
    pub dimension: String,
    pub dimension_name: String,
    pub score: f64,
    pub passed: bool,
    pub passed_weight: u32,
    pub applicable_weight: u32,
    pub criteria: Vec<CriterionResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionResult {
    pub dimension: String,
    pub name: String,
    pub level: String,
    pub level_name: String,
    pub level_index: usize,
    pub score: f64,
    pub next_level: Option<String>,
    pub next_level_name: Option<String>,
    pub next_level_progress: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub criterion_id: String,
    pub action: String,
    pub why_it_matters: String,
    pub evidence_hint: String,
    pub critical: bool,
    pub weight: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionChange {
    pub dimension: String,
    pub previous_level: String,
    pub current_level: String,
    pub change: LevelChange,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionChange {
    pub id: String,
    pub previous_status: Option<CriterionStatus>,
    pub current_status: Option<CriterionStatus>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportComparison {
    pub previous_generated_at: String,
    pub previous_overall_level: String,
    pub overall_change: LevelChange,
    pub dimension_changes: Vec<DimensionChange>,
    pub criteria_changes: Vec<CriterionChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessFluencyReport {
    pub model_version: u32,
    pub model_path: String,
    pub profile: String,
    pub repo_root: String,
    pub generated_at: String,
    pub snapshot_path: String,
    pub overall_level: String,
    pub overall_level_name: String,
    pub current_level_readiness: f64,
    pub next_level: Option<String>,
    pub next_level_name: Option<String>,
    pub next_level_readiness: Option<f64>,
    pub blocking_target_level: Option<String>,
    pub blocking_target_level_name: Option<String>,
    pub dimensions: HashMap<String, DimensionResult>,
    pub cells: Vec<CellResult>,
    pub criteria: Vec<CriterionResult>,
    pub blocking_criteria: Vec<CriterionResult>,
    pub recommendations: Vec<Recommendation>,
    pub comparison: Option<ReportComparison>,
}
