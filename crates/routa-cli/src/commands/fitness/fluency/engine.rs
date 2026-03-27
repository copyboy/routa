use chrono::Utc;
use glob::{MatchOptions, Pattern};
use serde_json::Value as JsonValue;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use walkdir::{DirEntry, WalkDir};

use super::model::load_fluency_model;
use super::support::build_regex;
use super::types::{
    CellResult, CriterionChange, CriterionResult, CriterionStatus, DetectorDefinition,
    DimensionChange, DimensionResult, EvaluateOptions, FluencyCriterion, FluencyDimension,
    FluencyLevel, HarnessFluencyReport, LevelChange, PathSegment, Recommendation, ReportComparison,
    ALLOWED_COMMAND_EXECUTABLES, CELL_PASS_THRESHOLD, DEFAULT_GLOB_IGNORE, MAX_RECOMMENDATIONS,
    MAX_REGEX_INPUT_LENGTH,
};

struct DetectorResult {
    status: CriterionStatus,
    detail: String,
    evidence: Vec<String>,
}

struct EvaluationContext {
    repo_root: PathBuf,
    ignore_patterns: Vec<Pattern>,
    text_cache: HashMap<PathBuf, String>,
    json_cache: HashMap<PathBuf, JsonValue>,
    yaml_cache: HashMap<PathBuf, JsonValue>,
}

impl EvaluationContext {
    fn new(repo_root: PathBuf) -> Result<Self, String> {
        Ok(Self {
            repo_root,
            ignore_patterns: compile_patterns(DEFAULT_GLOB_IGNORE)?,
            text_cache: HashMap::new(),
            json_cache: HashMap::new(),
            yaml_cache: HashMap::new(),
        })
    }
}

struct CommandExecutionResult {
    exit_code: i32,
    output: String,
    timed_out: bool,
}

struct MutableCellAccumulator {
    id: String,
    level: String,
    level_name: String,
    dimension: String,
    dimension_name: String,
    criteria: Vec<CriterionResult>,
}

pub fn evaluate_harness_fluency(options: &EvaluateOptions) -> Result<HarnessFluencyReport, String> {
    let model = load_fluency_model(&options.model_path)?;
    let level_order: HashMap<String, usize> = model
        .levels
        .iter()
        .enumerate()
        .map(|(index, level)| (level.id.clone(), index))
        .collect();
    let level_by_id: HashMap<String, FluencyLevel> = model
        .levels
        .iter()
        .cloned()
        .map(|level| (level.id.clone(), level))
        .collect();
    let dimension_by_id: HashMap<String, FluencyDimension> = model
        .dimensions
        .iter()
        .cloned()
        .map(|dimension| (dimension.id.clone(), dimension))
        .collect();

    let previous_snapshot = if options.compare_last {
        load_previous_snapshot(&options.snapshot_path)?
    } else {
        None
    };

    let mut context = EvaluationContext::new(options.repo_root.clone())?;
    let mut criteria_results = Vec::with_capacity(model.criteria.len());
    for criterion in &model.criteria {
        criteria_results.push(evaluate_criterion(criterion, &mut context)?);
    }

    let mut cell_accumulators: HashMap<String, MutableCellAccumulator> = HashMap::new();
    for criterion_result in &criteria_results {
        let level = level_by_id
            .get(&criterion_result.level)
            .ok_or_else(|| format!("unknown level {}", criterion_result.level))?;
        let dimension = dimension_by_id
            .get(&criterion_result.dimension)
            .ok_or_else(|| format!("unknown dimension {}", criterion_result.dimension))?;
        let cell_id = build_cell_id(&criterion_result.level, &criterion_result.dimension);
        cell_accumulators
            .entry(cell_id.clone())
            .and_modify(|accumulator| accumulator.criteria.push(criterion_result.clone()))
            .or_insert_with(|| MutableCellAccumulator {
                id: cell_id,
                level: criterion_result.level.clone(),
                level_name: level.name.clone(),
                dimension: criterion_result.dimension.clone(),
                dimension_name: dimension.name.clone(),
                criteria: vec![criterion_result.clone()],
            });
    }

    let mut cells = Vec::with_capacity(model.levels.len() * model.dimensions.len());
    for level in &model.levels {
        for dimension in &model.dimensions {
            let cell_id = build_cell_id(&level.id, &dimension.id);
            let mut accumulator = cell_accumulators
                .remove(&cell_id)
                .ok_or_else(|| format!("missing accumulated cell {}:{}", dimension.id, level.id))?;
            accumulator
                .criteria
                .sort_by(|left, right| left.id.cmp(&right.id));
            let applicable_weight: u32 = accumulator
                .criteria
                .iter()
                .filter(|criterion| criterion.status != CriterionStatus::Skipped)
                .map(|criterion| criterion.weight)
                .sum();
            let passed_weight: u32 = accumulator
                .criteria
                .iter()
                .filter(|criterion| criterion.status == CriterionStatus::Pass)
                .map(|criterion| criterion.weight)
                .sum();
            let score = if applicable_weight == 0 {
                0.0
            } else {
                passed_weight as f64 / applicable_weight as f64
            };

            cells.push(CellResult {
                id: accumulator.id,
                level: accumulator.level,
                level_name: accumulator.level_name,
                dimension: accumulator.dimension,
                dimension_name: accumulator.dimension_name,
                score,
                passed: applicable_weight > 0 && score >= CELL_PASS_THRESHOLD,
                passed_weight,
                applicable_weight,
                criteria: accumulator.criteria,
            });
        }
    }

    let cell_by_id: HashMap<String, CellResult> = cells
        .iter()
        .cloned()
        .map(|cell| (cell.id.clone(), cell))
        .collect();
    let mut dimensions = HashMap::new();
    for dimension in &model.dimensions {
        let mut achieved_index: isize = -1;
        for (index, level) in model.levels.iter().enumerate() {
            let cell = cell_by_id.get(&build_cell_id(&level.id, &dimension.id));
            if !cell.map(|entry| entry.passed).unwrap_or(false) {
                break;
            }
            achieved_index = index as isize;
        }

        let resolved_index = achieved_index.max(0) as usize;
        let current_level = &model.levels[resolved_index];
        let next_level = model.levels.get(resolved_index + 1);
        let current_cell_id = build_cell_id(&current_level.id, &dimension.id);
        dimensions.insert(
            dimension.id.clone(),
            DimensionResult {
                dimension: dimension.id.clone(),
                name: dimension.name.clone(),
                level: current_level.id.clone(),
                level_name: current_level.name.clone(),
                level_index: resolved_index,
                score: cell_by_id
                    .get(&current_cell_id)
                    .map(|cell| cell.score)
                    .unwrap_or(0.0),
                next_level: next_level.map(|level| level.id.clone()),
                next_level_name: next_level.map(|level| level.name.clone()),
                next_level_progress: next_level
                    .and_then(|level| cell_by_id.get(&build_cell_id(&level.id, &dimension.id)))
                    .map(|cell| cell.score),
            },
        );
    }

    let overall_level_index = dimensions
        .values()
        .map(|dimension| dimension.level_index)
        .min()
        .ok_or_else(|| "fluency model has no dimensions".to_string())?;
    let overall_level = &model.levels[overall_level_index];
    let next_level = model.levels.get(overall_level_index + 1);
    let current_level_readiness =
        average_cell_scores(&model.dimensions, &cell_by_id, &overall_level.id);
    let current_level_debt =
        collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &overall_level.id);
    let next_level_readiness = match (next_level, current_level_debt.is_empty()) {
        (Some(level), true) => Some(average_cell_scores(
            &model.dimensions,
            &cell_by_id,
            &level.id,
        )),
        _ => None,
    };
    let blocking_target_level = if !current_level_debt.is_empty() {
        Some(overall_level)
    } else {
        next_level
    };
    let mut blocking_criteria = match blocking_target_level {
        None => Vec::new(),
        Some(level) if level.id == overall_level.id => current_level_debt.clone(),
        Some(level) => {
            collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &level.id)
        }
    };
    blocking_criteria.sort_by(|left, right| left.id.cmp(&right.id));

    criteria_results.sort_by(|left, right| left.id.cmp(&right.id));
    let mut report = HarnessFluencyReport {
        model_version: model.version,
        model_path: options.model_path.display().to_string(),
        profile: options.profile.clone(),
        repo_root: options.repo_root.display().to_string(),
        generated_at: Utc::now().to_rfc3339(),
        snapshot_path: options.snapshot_path.display().to_string(),
        overall_level: overall_level.id.clone(),
        overall_level_name: overall_level.name.clone(),
        current_level_readiness,
        next_level: next_level.map(|level| level.id.clone()),
        next_level_name: next_level.map(|level| level.name.clone()),
        next_level_readiness,
        blocking_target_level: blocking_target_level.map(|level| level.id.clone()),
        blocking_target_level_name: blocking_target_level.map(|level| level.name.clone()),
        dimensions,
        cells,
        criteria: criteria_results,
        blocking_criteria: blocking_criteria.clone(),
        recommendations: collect_recommendations(&blocking_criteria),
        comparison: None,
    };

    if let Some(previous_report) = previous_snapshot {
        if can_compare_reports(&previous_report, &report) {
            report.comparison = Some(build_comparison(&previous_report, &report, &level_order));
        }
    }

    if options.save {
        persist_snapshot(&report, &options.snapshot_path)?;
    }

    Ok(report)
}

fn build_cell_id(level: &str, dimension: &str) -> String {
    format!("{dimension}:{level}")
}

fn compile_patterns(patterns: &[&str]) -> Result<Vec<Pattern>, String> {
    patterns
        .iter()
        .map(|pattern| Pattern::new(pattern).map_err(|error| error.to_string()))
        .collect()
}

fn glob_match_options() -> MatchOptions {
    MatchOptions {
        case_sensitive: true,
        require_literal_separator: false,
        require_literal_leading_dot: false,
    }
}

fn is_ignored(relative_path: &Path, ignore_patterns: &[Pattern]) -> bool {
    ignore_patterns
        .iter()
        .any(|pattern| pattern.matches_path_with(relative_path, glob_match_options()))
}

fn keep_entry(entry: &DirEntry, repo_root: &Path, ignore_patterns: &[Pattern]) -> bool {
    if entry.path() == repo_root {
        return true;
    }

    entry
        .path()
        .strip_prefix(repo_root)
        .map(|relative| !is_ignored(relative, ignore_patterns))
        .unwrap_or(true)
}

fn collect_glob_matches(
    patterns: &[String],
    repo_root: &Path,
    ignore_patterns: &[Pattern],
    nodir: bool,
) -> Result<Vec<String>, String> {
    let compiled_patterns = patterns
        .iter()
        .map(|pattern| Pattern::new(pattern).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    let mut matches = HashSet::new();
    for entry in WalkDir::new(repo_root)
        .into_iter()
        .filter_entry(|entry| keep_entry(entry, repo_root, ignore_patterns))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path() == repo_root {
            continue;
        }
        if nodir && entry.file_type().is_dir() {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(repo_root)
            .map_err(|error| error.to_string())?;
        if compiled_patterns
            .iter()
            .any(|pattern| pattern.matches_path_with(relative, glob_match_options()))
        {
            matches.insert(path_to_slash(relative));
        }
    }

    let mut values = matches.into_iter().collect::<Vec<_>>();
    values.sort();
    Ok(values)
}

fn path_to_slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_absolute_path(base_path: &Path, target_path: &str) -> PathBuf {
    let candidate = Path::new(target_path);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base_path.join(candidate)
    }
}

fn path_exists(target_path: &Path) -> bool {
    target_path.exists()
}

fn read_text_file(context: &mut EvaluationContext, relative_path: &str) -> Result<String, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.text_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {}: {error}", relative_path))?;
    context.text_cache.insert(absolute_path, content.clone());
    Ok(content)
}

fn read_json_file(
    context: &mut EvaluationContext,
    relative_path: &str,
) -> Result<JsonValue, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.json_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {}: {error}", relative_path))?;
    let document = serde_json::from_str::<JsonValue>(&content)
        .map_err(|error| format!("unable to parse {}: {error}", relative_path))?;
    context.json_cache.insert(absolute_path, document.clone());
    Ok(document)
}

fn read_yaml_file(
    context: &mut EvaluationContext,
    relative_path: &str,
) -> Result<JsonValue, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.yaml_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {}: {error}", relative_path))?;
    let document = serde_yaml::from_str::<JsonValue>(&content)
        .map_err(|error| format!("unable to parse {}: {error}", relative_path))?;
    context.yaml_cache.insert(absolute_path, document.clone());
    Ok(document)
}

fn test_regex_against_text(
    pattern: &str,
    flags: &str,
    text: &str,
    label: &str,
) -> Result<bool, String> {
    let regex = build_regex(pattern, flags, label)?;
    let capped = if text.len() > MAX_REGEX_INPUT_LENGTH {
        &text[..MAX_REGEX_INPUT_LENGTH]
    } else {
        text
    };
    Ok(regex.is_match(capped))
}

fn lookup_path<'a>(source: &'a JsonValue, spec: &[PathSegment]) -> Option<&'a JsonValue> {
    let mut current = source;
    for segment in spec {
        match segment {
            PathSegment::Index(index) => {
                let array = current.as_array()?;
                current = array.get(*index)?;
            }
            PathSegment::Key(key) => {
                let object = current.as_object()?;
                current = object.get(key)?;
            }
        }
    }
    Some(current)
}

fn evaluate_detector(
    detector: &DetectorDefinition,
    context: &mut EvaluationContext,
) -> Result<DetectorResult, String> {
    match detector {
        DetectorDefinition::FileExists { path } => {
            let exists = path_exists(&normalize_absolute_path(&context.repo_root, path));
            Ok(DetectorResult {
                status: if exists {
                    CriterionStatus::Pass
                } else {
                    CriterionStatus::Fail
                },
                detail: if exists {
                    format!("found {path}")
                } else {
                    format!("missing {path}")
                },
                evidence: if exists {
                    vec![path.clone()]
                } else {
                    Vec::new()
                },
            })
        }
        DetectorDefinition::FileContainsRegex {
            path,
            pattern,
            flags,
        } => match read_text_file(context, path) {
            Ok(content) => {
                let passed =
                    test_regex_against_text(pattern, flags, &content, "file_contains_regex")?;
                Ok(DetectorResult {
                    status: if passed {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: if passed {
                        format!("content in {path} matched {pattern}")
                    } else {
                        format!("content in {path} did not match {pattern}")
                    },
                    evidence: if passed {
                        vec![path.clone()]
                    } else {
                        Vec::new()
                    },
                })
            }
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: error,
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::AnyOf { detectors } => {
            let mut failures = Vec::new();
            let mut skipped_count = 0;
            for nested in detectors {
                let result = evaluate_detector(nested, context)?;
                if result.status == CriterionStatus::Pass {
                    return Ok(DetectorResult {
                        status: CriterionStatus::Pass,
                        detail: format!("matched {}: {}", nested.detector_type(), result.detail),
                        evidence: result.evidence,
                    });
                }
                if result.status == CriterionStatus::Skipped {
                    skipped_count += 1;
                }
                failures.push(format!("{}: {}", nested.detector_type(), result.detail));
            }

            if skipped_count == detectors.len() {
                return Ok(DetectorResult {
                    status: CriterionStatus::Skipped,
                    detail: "all alternatives were skipped".to_string(),
                    evidence: Vec::new(),
                });
            }

            Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: format!("all alternatives failed: {}", failures.join(" | ")),
                evidence: Vec::new(),
            })
        }
        DetectorDefinition::AnyFileExists { paths } => {
            let matched = paths
                .iter()
                .filter(|candidate| {
                    path_exists(&normalize_absolute_path(&context.repo_root, candidate))
                })
                .cloned()
                .collect::<Vec<_>>();
            Ok(DetectorResult {
                status: if matched.is_empty() {
                    CriterionStatus::Fail
                } else {
                    CriterionStatus::Pass
                },
                detail: if matched.is_empty() {
                    format!("missing all candidates: {}", paths.join(", "))
                } else {
                    format!("found {}", matched.join(", "))
                },
                evidence: matched,
            })
        }
        DetectorDefinition::GlobCount { patterns, min } => match collect_glob_matches(
            patterns,
            &context.repo_root,
            &context.ignore_patterns,
            false,
        ) {
            Ok(matches) => Ok(DetectorResult {
                status: if matches.len() >= *min {
                    CriterionStatus::Pass
                } else {
                    CriterionStatus::Fail
                },
                detail: format!("matched {} paths (min {min})", matches.len()),
                evidence: matches.into_iter().take(10).collect(),
            }),
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: format!("glob failed: {error}"),
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::GlobContainsRegex {
            patterns,
            pattern,
            flags,
            min_matches,
        } => {
            match collect_glob_matches(patterns, &context.repo_root, &context.ignore_patterns, true)
            {
                Ok(candidates) => {
                    let mut matched = Vec::new();
                    for candidate in candidates.iter() {
                        let content = match read_text_file(context, candidate) {
                            Ok(content) => content,
                            Err(_) => continue,
                        };
                        if test_regex_against_text(pattern, flags, &content, "glob_contains_regex")?
                        {
                            matched.push(candidate.clone());
                        }
                        if matched.len() >= *min_matches {
                            break;
                        }
                    }

                    Ok(DetectorResult {
                        status: if matched.len() >= *min_matches {
                            CriterionStatus::Pass
                        } else {
                            CriterionStatus::Fail
                        },
                        detail: format!(
                            "regex matched {} files (min {min_matches}) across {} candidates",
                            matched.len(),
                            candidates.len()
                        ),
                        evidence: matched.into_iter().take(10).collect(),
                    })
                }
                Err(error) => Ok(DetectorResult {
                    status: CriterionStatus::Fail,
                    detail: format!("glob regex failed: {error}"),
                    evidence: Vec::new(),
                }),
            }
        }
        DetectorDefinition::JsonPathExists { path, json_path } => {
            match read_json_file(context, path) {
                Ok(document) => {
                    let resolved = lookup_path(&document, json_path);
                    Ok(DetectorResult {
                        status: if resolved.is_some() {
                            CriterionStatus::Pass
                        } else {
                            CriterionStatus::Fail
                        },
                        detail: if resolved.is_some() {
                            format!("found JSON path {} in {path}", path_spec_label(json_path))
                        } else {
                            format!("missing JSON path {} in {path}", path_spec_label(json_path))
                        },
                        evidence: if resolved.is_some() {
                            vec![path.clone()]
                        } else {
                            Vec::new()
                        },
                    })
                }
                Err(error) => Ok(DetectorResult {
                    status: CriterionStatus::Fail,
                    detail: error,
                    evidence: Vec::new(),
                }),
            }
        }
        DetectorDefinition::YamlPathExists { path, yaml_path } => {
            match read_yaml_file(context, path) {
                Ok(document) => {
                    let resolved = lookup_path(&document, yaml_path);
                    Ok(DetectorResult {
                        status: if resolved.is_some() {
                            CriterionStatus::Pass
                        } else {
                            CriterionStatus::Fail
                        },
                        detail: if resolved.is_some() {
                            format!("found YAML path {} in {path}", path_spec_label(yaml_path))
                        } else {
                            format!("missing YAML path {} in {path}", path_spec_label(yaml_path))
                        },
                        evidence: if resolved.is_some() {
                            vec![path.clone()]
                        } else {
                            Vec::new()
                        },
                    })
                }
                Err(error) => Ok(DetectorResult {
                    status: CriterionStatus::Fail,
                    detail: error,
                    evidence: Vec::new(),
                }),
            }
        }
        DetectorDefinition::CommandExitCode {
            command,
            expected_exit_code,
            timeout_ms,
        } => match run_command(command, &context.repo_root, *timeout_ms) {
            Ok(result) => Ok(DetectorResult {
                status: if result.exit_code == *expected_exit_code {
                    CriterionStatus::Pass
                } else {
                    CriterionStatus::Fail
                },
                detail: if result.timed_out {
                    format!("command timed out after {timeout_ms}ms")
                } else {
                    format!(
                        "exit code {}, expected {}",
                        result.exit_code, expected_exit_code
                    )
                },
                evidence: if result.output.is_empty() {
                    Vec::new()
                } else {
                    vec![result.output]
                },
            }),
            Err(error) => Ok(build_command_failure(error)),
        },
        DetectorDefinition::CommandOutputRegex {
            command,
            pattern,
            flags,
            expected_exit_code,
            timeout_ms,
        } => match run_command(command, &context.repo_root, *timeout_ms) {
            Ok(result) => {
                let passed = !result.timed_out
                    && result.exit_code == *expected_exit_code
                    && test_regex_against_text(
                        pattern,
                        flags,
                        &result.output,
                        "command_output_regex",
                    )?;
                Ok(DetectorResult {
                    status: if passed {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: if result.timed_out {
                        format!("command timed out after {timeout_ms}ms")
                    } else if passed {
                        format!("command output matched {pattern}")
                    } else {
                        format!("command output did not match {pattern}")
                    },
                    evidence: if result.output.is_empty() {
                        Vec::new()
                    } else {
                        vec![result.output]
                    },
                })
            }
            Err(error) => Ok(build_command_failure(error)),
        },
        DetectorDefinition::ManualAttestation { prompt } => Ok(DetectorResult {
            status: CriterionStatus::Skipped,
            detail: format!("manual attestation required: {prompt}"),
            evidence: Vec::new(),
        }),
    }
}

fn build_command_failure(error: String) -> DetectorResult {
    DetectorResult {
        status: CriterionStatus::Fail,
        detail: error,
        evidence: Vec::new(),
    }
}

fn evaluate_criterion(
    criterion: &FluencyCriterion,
    context: &mut EvaluationContext,
) -> Result<CriterionResult, String> {
    let detector_result = evaluate_detector(&criterion.detector, context)?;
    Ok(CriterionResult {
        id: criterion.id.clone(),
        level: criterion.level.clone(),
        dimension: criterion.dimension.clone(),
        weight: criterion.weight,
        critical: criterion.critical,
        status: detector_result.status,
        detector_type: criterion.detector.detector_type().to_string(),
        detail: detector_result.detail,
        evidence: detector_result.evidence,
        why_it_matters: criterion.why_it_matters.clone(),
        recommended_action: criterion.recommended_action.clone(),
        evidence_hint: criterion.evidence_hint.clone(),
    })
}

fn deterministic_priority(detector_type: &str) -> u8 {
    if detector_type == "manual_attestation" {
        1
    } else {
        0
    }
}

fn compare_level_ids(
    previous_level: &str,
    current_level: &str,
    order: &HashMap<String, usize>,
) -> LevelChange {
    let previous_index = order.get(previous_level).copied().unwrap_or(usize::MAX);
    let current_index = order.get(current_level).copied().unwrap_or(usize::MAX);
    if previous_index == current_index {
        LevelChange::Same
    } else if current_index > previous_index {
        LevelChange::Up
    } else {
        LevelChange::Down
    }
}

fn collect_recommendations(criteria: &[CriterionResult]) -> Vec<Recommendation> {
    let mut deduped = HashSet::new();
    let mut sorted = criteria
        .iter()
        .filter(|criterion| criterion.status == CriterionStatus::Fail)
        .cloned()
        .collect::<Vec<_>>();
    sorted.sort_by(|left, right| {
        right
            .critical
            .cmp(&left.critical)
            .then(right.weight.cmp(&left.weight))
            .then(
                deterministic_priority(&left.detector_type)
                    .cmp(&deterministic_priority(&right.detector_type)),
            )
            .then(left.id.cmp(&right.id))
    });

    sorted
        .into_iter()
        .filter(|criterion| deduped.insert(criterion.recommended_action.clone()))
        .take(MAX_RECOMMENDATIONS)
        .map(|criterion| Recommendation {
            criterion_id: criterion.id,
            action: criterion.recommended_action,
            why_it_matters: criterion.why_it_matters,
            evidence_hint: criterion.evidence_hint,
            critical: criterion.critical,
            weight: criterion.weight,
        })
        .collect()
}

fn average_cell_scores(
    dimensions: &[FluencyDimension],
    cell_by_id: &HashMap<String, CellResult>,
    level_id: &str,
) -> f64 {
    let total: f64 = dimensions
        .iter()
        .map(|dimension| {
            cell_by_id
                .get(&build_cell_id(level_id, &dimension.id))
                .map(|cell| cell.score)
                .unwrap_or(0.0)
        })
        .sum();
    total / dimensions.len() as f64
}

fn collect_failing_criteria_for_level(
    dimensions: &[FluencyDimension],
    cell_by_id: &HashMap<String, CellResult>,
    level_id: &str,
) -> Vec<CriterionResult> {
    let mut failing = Vec::new();
    for dimension in dimensions {
        if let Some(cell) = cell_by_id.get(&build_cell_id(level_id, &dimension.id)) {
            if !cell.passed {
                failing.extend(
                    cell.criteria
                        .iter()
                        .filter(|criterion| criterion.status == CriterionStatus::Fail)
                        .cloned(),
                );
            }
        }
    }
    failing
}

fn load_previous_snapshot(snapshot_path: &Path) -> Result<Option<HarnessFluencyReport>, String> {
    if !snapshot_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(snapshot_path).map_err(|error| {
        format!(
            "unable to read snapshot {}: {error}",
            snapshot_path.display()
        )
    })?;
    let report = serde_json::from_str::<HarnessFluencyReport>(&content).map_err(|error| {
        format!(
            "unable to parse snapshot {}: {error}",
            snapshot_path.display()
        )
    })?;
    Ok(Some(report))
}

fn build_comparison(
    previous_report: &HarnessFluencyReport,
    current_report: &HarnessFluencyReport,
    level_order: &HashMap<String, usize>,
) -> ReportComparison {
    let mut dimension_changes = current_report
        .dimensions
        .values()
        .map(|dimension| {
            let previous_dimension = previous_report.dimensions.get(&dimension.dimension);
            DimensionChange {
                dimension: dimension.dimension.clone(),
                previous_level: previous_dimension
                    .map(|entry| entry.level.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                current_level: dimension.level.clone(),
                change: previous_dimension
                    .map(|entry| compare_level_ids(&entry.level, &dimension.level, level_order))
                    .unwrap_or(LevelChange::Up),
            }
        })
        .collect::<Vec<_>>();
    dimension_changes.sort_by(|left, right| left.dimension.cmp(&right.dimension));

    let previous_criteria = previous_report
        .criteria
        .iter()
        .map(|criterion| (criterion.id.clone(), criterion.status.clone()))
        .collect::<HashMap<_, _>>();
    let current_criteria = current_report
        .criteria
        .iter()
        .map(|criterion| (criterion.id.clone(), criterion.status.clone()))
        .collect::<HashMap<_, _>>();

    let mut all_ids = previous_criteria
        .keys()
        .chain(current_criteria.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    all_ids.sort();

    let criteria_changes = all_ids
        .into_iter()
        .filter_map(|id| {
            let previous_status = previous_criteria.get(&id).cloned();
            let current_status = current_criteria.get(&id).cloned();
            if previous_status == current_status {
                None
            } else {
                Some(CriterionChange {
                    id,
                    previous_status,
                    current_status,
                })
            }
        })
        .collect::<Vec<_>>();

    ReportComparison {
        previous_generated_at: previous_report.generated_at.clone(),
        previous_overall_level: previous_report.overall_level.clone(),
        overall_change: compare_level_ids(
            &previous_report.overall_level,
            &current_report.overall_level,
            level_order,
        ),
        dimension_changes,
        criteria_changes,
    }
}

fn can_compare_reports(
    previous_report: &HarnessFluencyReport,
    current_report: &HarnessFluencyReport,
) -> bool {
    previous_report.model_version == current_report.model_version
        && previous_report.profile == current_report.profile
}

fn persist_snapshot(report: &HarnessFluencyReport, snapshot_path: &Path) -> Result<(), String> {
    if let Some(parent) = snapshot_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("unable to create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("unable to serialize report: {error}"))?;
    fs::write(snapshot_path, format!("{json}\n"))
        .map_err(|error| format!("unable to write {}: {error}", snapshot_path.display()))
}

fn path_spec_label(spec: &[PathSegment]) -> String {
    spec.iter()
        .map(|segment| match segment {
            PathSegment::Key(key) => key.clone(),
            PathSegment::Index(index) => index.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn parse_command(command: &str) -> Result<(String, Vec<String>), String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaping = false;

    let push_current = |tokens: &mut Vec<String>, current: &mut String| {
        if !current.is_empty() {
            tokens.push(std::mem::take(current));
        }
    };

    for ch in command.chars() {
        if escaping {
            current.push(ch);
            escaping = false;
            continue;
        }

        if ch == '\\' {
            escaping = true;
            continue;
        }

        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }

        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }

        if ch.is_whitespace() {
            push_current(&mut tokens, &mut current);
            continue;
        }

        current.push(ch);
    }

    if escaping || quote.is_some() {
        return Err("command contains unterminated escaping or quotes".to_string());
    }

    push_current(&mut tokens, &mut current);
    if tokens.is_empty() {
        return Err("command must not be empty".to_string());
    }

    Ok((tokens[0].clone(), tokens[1..].to_vec()))
}

fn validate_executable(executable: &str) -> Result<(), String> {
    if executable.contains('/') || executable.contains('\\') {
        return Err(format!(
            "command executable \"{executable}\" must be a bare allowlisted name"
        ));
    }

    let command_name = Path::new(executable)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or(executable);
    if !ALLOWED_COMMAND_EXECUTABLES.contains(&command_name) {
        return Err(format!(
            "command executable \"{command_name}\" is not allowed"
        ));
    }

    Ok(())
}

fn read_pipe(mut pipe: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = pipe.read_to_end(&mut buffer);
        String::from_utf8_lossy(&buffer).to_string()
    })
}

fn run_command(
    command: &str,
    repo_root: &Path,
    timeout_ms: u64,
) -> Result<CommandExecutionResult, String> {
    let (executable, args) = parse_command(command)?;
    validate_executable(&executable)?;

    let mut child = Command::new(&executable)
        .args(&args)
        .current_dir(repo_root)
        .env("PATH", routa_core::shell_env::full_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout_handle = child
        .stdout
        .take()
        .map(read_pipe)
        .ok_or_else(|| "failed to capture command stdout".to_string())?;
    let stderr_handle = child
        .stderr
        .take()
        .map(read_pipe)
        .ok_or_else(|| "failed to capture command stderr".to_string())?;

    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);
    let (status, timed_out) = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break (status, false),
            None if start.elapsed() >= timeout => {
                let _ = child.kill();
                let status = child.wait().map_err(|error| error.to_string())?;
                break (status, true);
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };

    let stdout = stdout_handle
        .join()
        .map_err(|_| "failed to join stdout reader".to_string())?;
    let stderr = stderr_handle
        .join()
        .map_err(|_| "failed to join stderr reader".to_string())?;
    let output = format!("{stdout}{stderr}").trim().to_string();

    Ok(CommandExecutionResult {
        exit_code: status.code().unwrap_or(1),
        output,
        timed_out,
    })
}
