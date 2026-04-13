use crate::test_mapping::{self, TestMappingRecord, TestMappingStatus};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct ReviewContextReport {
    pub status: String,
    pub analysis_mode: String,
    pub summary: String,
    pub base: String,
    pub context: ReviewContextPayload,
    pub build: ReviewBuildInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewContextPayload {
    pub changed_files: Vec<String>,
    pub impacted_files: Vec<String>,
    pub graph: GraphContext,
    pub targets: Vec<ReviewTarget>,
    pub tests: ReviewTests,
    pub review_guidance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_snippets: Option<Vec<SourceSnippet>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphContext {
    pub changed_nodes: Vec<serde_json::Value>,
    pub impacted_nodes: Vec<serde_json::Value>,
    pub edges: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewTarget {
    pub qualified_name: String,
    pub kind: String,
    pub file_path: String,
    pub tests: Vec<TestTarget>,
    pub tests_count: usize,
    pub inherited_tests: Vec<TestTarget>,
    pub inherited_tests_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestTarget {
    pub qualified_name: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub is_test: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewTests {
    pub test_files: Vec<String>,
    pub untested_targets: Vec<UntestedTarget>,
    pub query_failures: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UntestedTarget {
    pub qualified_name: String,
    pub kind: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceSnippet {
    pub file_path: String,
    pub line_count: usize,
    pub truncated: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewBuildInfo {
    pub status: String,
    pub build_type: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy)]
pub struct ReviewContextOptions<'a> {
    pub base: &'a str,
    pub include_source: bool,
    pub max_files: usize,
    pub max_lines_per_file: usize,
}

pub fn build_review_context(
    repo_root: &Path,
    changed_files: &[String],
    options: ReviewContextOptions<'_>,
) -> ReviewContextReport {
    let mapping = test_mapping::analyze_changed_files(repo_root, changed_files);
    let test_files = collect_test_files(&mapping);
    let impacted_files = collect_impacted_files(&mapping.changed_files, &test_files);
    let targets = build_targets(&mapping.mappings);
    let untested_targets = build_untested_targets(&mapping.mappings);
    let review_guidance =
        generate_review_guidance(&untested_targets, test_files.len(), impacted_files.len());
    let source_snippets = options.include_source.then(|| {
        collect_source_snippets(
            repo_root,
            &mapping.changed_files,
            &test_files,
            &impacted_files,
            options.max_files,
            options.max_lines_per_file,
        )
    });

    let summary = format!(
        "Review context for {} changed file(s):\n  - {} directly changed nodes\n  - {} impacted nodes in {} files\n\nReview guidance:\n{}",
        mapping.changed_files.len(),
        0,
        0,
        impacted_files.len(),
        review_guidance
    );

    ReviewContextReport {
        status: "ok".to_string(),
        analysis_mode: "current_graph".to_string(),
        summary,
        base: options.base.to_string(),
        context: ReviewContextPayload {
            changed_files: mapping.changed_files,
            impacted_files,
            graph: GraphContext {
                changed_nodes: Vec::new(),
                impacted_nodes: Vec::new(),
                edges: Vec::new(),
            },
            targets,
            tests: ReviewTests {
                test_files,
                untested_targets,
                query_failures: Vec::new(),
            },
            review_guidance,
            source_snippets,
        },
        build: ReviewBuildInfo {
            status: "skipped".to_string(),
            build_type: "heuristic_only".to_string(),
            reason: "graph backend not implemented; using repository-local test mapping heuristics"
                .to_string(),
        },
    }
}

fn collect_test_files(report: &test_mapping::TestMappingReport) -> Vec<String> {
    let mut test_files = BTreeSet::new();
    for path in &report.skipped_test_files {
        test_files.insert(path.clone());
    }
    for record in &report.mappings {
        for path in &record.related_test_files {
            test_files.insert(path.clone());
        }
    }
    test_files.into_iter().collect()
}

fn collect_impacted_files(changed_files: &[String], test_files: &[String]) -> Vec<String> {
    let mut impacted = Vec::new();
    let mut seen = BTreeSet::new();
    for path in changed_files.iter().chain(test_files.iter()) {
        if seen.insert(path.clone()) {
            impacted.push(path.clone());
        }
    }
    impacted
}

fn build_targets(mappings: &[TestMappingRecord]) -> Vec<ReviewTarget> {
    mappings
        .iter()
        .map(|record| {
            let tests: Vec<TestTarget> = record
                .related_test_files
                .iter()
                .map(|path| TestTarget {
                    qualified_name: path.clone(),
                    name: file_name(path),
                    kind: "File".to_string(),
                    file_path: path.clone(),
                    is_test: true,
                })
                .collect();
            ReviewTarget {
                qualified_name: record.source_file.clone(),
                kind: "File".to_string(),
                file_path: record.source_file.clone(),
                tests_count: tests.len(),
                tests,
                inherited_tests: Vec::new(),
                inherited_tests_count: 0,
                status: Some(record.status.as_str().to_string()),
            }
        })
        .collect()
}

fn build_untested_targets(mappings: &[TestMappingRecord]) -> Vec<UntestedTarget> {
    mappings
        .iter()
        .filter(|record| {
            matches!(
                record.status,
                TestMappingStatus::Missing | TestMappingStatus::Unknown
            )
        })
        .map(|record| UntestedTarget {
            qualified_name: record.source_file.clone(),
            kind: "File".to_string(),
            file_path: record.source_file.clone(),
        })
        .collect()
}

fn generate_review_guidance(
    untested_targets: &[UntestedTarget],
    impacted_test_files: usize,
    impacted_files: usize,
) -> String {
    let mut guidance_parts = Vec::new();

    if !untested_targets.is_empty() {
        let names = untested_targets
            .iter()
            .take(5)
            .map(|target| target.qualified_name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        guidance_parts.push(format!(
            "- {} changed target(s) lack direct or inherited tests: {}",
            untested_targets.len(),
            names
        ));
    }

    if impacted_test_files > 0 {
        guidance_parts.push(format!(
            "- {} impacted test file(s) were identified. Prioritize those before broader regression sweeps.",
            impacted_test_files
        ));
    }

    if impacted_files > 12 {
        guidance_parts.push(format!(
            "- Wide blast radius: {} impacted files. Review callers, API routes, and downstream workflows carefully.",
            impacted_files
        ));
    }

    if impacted_files > 0 && untested_targets.is_empty() && impacted_files <= 12 {
        guidance_parts
            .push("- Changes appear locally test-covered and reasonably contained.".to_string());
    }

    if guidance_parts.is_empty() {
        guidance_parts.push("- No graph-derived review guidance available.".to_string());
    }

    guidance_parts.join("\n")
}

fn collect_source_snippets(
    repo_root: &Path,
    changed_files: &[String],
    test_files: &[String],
    impacted_files: &[String],
    max_files: usize,
    max_lines_per_file: usize,
) -> Vec<SourceSnippet> {
    let mut ranked_paths = Vec::new();
    let mut seen = BTreeSet::new();
    for path in changed_files
        .iter()
        .chain(test_files.iter())
        .chain(impacted_files.iter())
    {
        if seen.insert(path.clone()) {
            ranked_paths.push(path.clone());
        }
    }

    ranked_paths
        .into_iter()
        .take(max_files)
        .filter_map(|relative_path| {
            read_source_snippet(repo_root, &relative_path, max_lines_per_file)
        })
        .collect()
}

fn read_source_snippet(
    repo_root: &Path,
    relative_path: &str,
    max_lines: usize,
) -> Option<SourceSnippet> {
    let path = repo_root.join(relative_path);
    if !path.is_file() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let lines: Vec<&str> = content.lines().collect();

    Some(SourceSnippet {
        file_path: relative_path.to_string(),
        line_count: lines.len(),
        truncated: lines.len() > max_lines,
        content: lines
            .into_iter()
            .take(max_lines)
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{build_review_context, ReviewContextOptions};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn review_context_includes_guidance_and_source() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/service.ts"),
            "export function run() {\n  return 1;\n}\n",
        )
        .unwrap();
        fs::write(root.join("src/service.test.ts"), "test('run', () => {})\n").unwrap();

        let result = build_review_context(
            root,
            &["src/service.ts".to_string()],
            ReviewContextOptions {
                base: "HEAD",
                include_source: true,
                max_files: 12,
                max_lines_per_file: 120,
            },
        );

        assert_eq!(result.status, "ok");
        assert!(result.summary.contains("Review guidance:"));
        assert_eq!(
            result.context.changed_files,
            vec!["src/service.ts".to_string()]
        );
        assert_eq!(
            result.context.tests.test_files,
            vec!["src/service.test.ts".to_string()]
        );
        assert_eq!(
            result.context.source_snippets.as_ref().unwrap()[0].file_path,
            "src/service.ts"
        );
        assert!(result
            .context
            .review_guidance
            .contains("Changes appear locally test-covered"));
    }

    #[test]
    fn review_context_marks_missing_tests_as_untested() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/service.ts"), "export function run() {}\n").unwrap();

        let result = build_review_context(
            root,
            &["src/service.ts".to_string()],
            ReviewContextOptions {
                base: "HEAD",
                include_source: false,
                max_files: 12,
                max_lines_per_file: 120,
            },
        );

        assert_eq!(result.context.tests.untested_targets.len(), 1);
        assert!(result
            .context
            .review_guidance
            .contains("lack direct or inherited tests"));
        assert!(result.context.source_snippets.is_none());
    }
}
