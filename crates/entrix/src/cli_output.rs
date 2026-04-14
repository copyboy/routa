use entrix::long_file::LongFileAnalysisReport;
use entrix::model::FitnessReport;
use entrix::release_trigger::ReleaseTriggerReport;
use entrix::review_trigger::ReviewTriggerReport;

pub(crate) fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("failed to serialize json output: {error}");
        }
    }
}

pub(crate) fn print_report_text(report: &FitnessReport, verbose: bool) {
    let status = if report.hard_gate_blocked || report.score_blocked {
        "FAIL"
    } else {
        "PASS"
    };

    println!("Entrix fitness: {status}");
    println!("Final score: {:.1}%", report.final_score);
    println!("Hard gate blocked: {}", report.hard_gate_blocked);
    println!("Score blocked: {}", report.score_blocked);

    for dimension in &report.dimensions {
        println!(
            "- {}: {:.1}% ({}/{})",
            dimension.dimension, dimension.score, dimension.passed, dimension.total
        );

        if verbose {
            for result in &dimension.results {
                println!(
                    "  {} [{}] {} ({:.0}ms)",
                    if result.passed { "PASS" } else { "FAIL" },
                    result.tier.as_str(),
                    result.metric_name,
                    result.duration_ms
                );
            }
        }
    }
}

fn format_line_span(start: usize, end: usize) -> String {
    if start == end {
        format!("L{start}")
    } else {
        format!("L{start}-L{end}")
    }
}

pub(crate) fn print_hook_long_file_summary(report: &LongFileAnalysisReport) {
    for line in hook_long_file_summary_lines(report) {
        println!("{line}");
    }
}

pub(crate) fn hook_long_file_summary_lines(report: &LongFileAnalysisReport) -> Vec<String> {
    const MAX_CLASSES: usize = 3;
    const MAX_METHODS_PER_CLASS: usize = 4;
    const MAX_FUNCTIONS: usize = 5;

    if report.files.is_empty() {
        return vec!["Structure summary unavailable: no supported files for structural analysis."
            .to_string()];
    }

    let mut lines = vec!["Structure summary (tree-sitter symbols):".to_string()];
    for item in &report.files {
        lines.push(format!("- {}", item.file_path));

        if item.classes.is_empty() && item.functions.is_empty() {
            lines.push("  no class/function symbols found".to_string());
            continue;
        }

        for cls in item.classes.iter().take(MAX_CLASSES) {
            lines.push(format!(
                "  class {} ({}, methods={})",
                cls.name,
                format_line_span(cls.start_line, cls.end_line),
                cls.method_count,
            ));
            for method in cls.methods.iter().take(MAX_METHODS_PER_CLASS) {
                lines.push(format!(
                    "    method {} ({})",
                    method.name,
                    format_line_span(method.start_line, method.end_line),
                ));
            }
            let remaining_methods = cls.methods.len().saturating_sub(MAX_METHODS_PER_CLASS);
            if remaining_methods > 0 {
                lines.push(format!("    ... {remaining_methods} more method(s)"));
            }
        }

        let remaining_classes = item.classes.len().saturating_sub(MAX_CLASSES);
        if remaining_classes > 0 {
            lines.push(format!("  ... {remaining_classes} more class(es)"));
        }

        if !item.functions.is_empty() {
            let compact: Vec<String> = item
                .functions
                .iter()
                .take(MAX_FUNCTIONS)
                .map(|f| {
                    format!(
                        "{} ({})",
                        f.name,
                        format_line_span(f.start_line, f.end_line),
                    )
                })
                .collect();
            lines.push(format!("  functions: {}", compact.join(", ")));
            let remaining_functions = item.functions.len().saturating_sub(MAX_FUNCTIONS);
            if remaining_functions > 0 {
                lines.push(format!("  ... {remaining_functions} more function(s)"));
            }
        }

        if !item.warnings.is_empty() {
            lines.push(format!("  review-warnings: {}", item.warnings.len()));
        }
    }

    lines
}

pub(crate) fn print_long_file_report(report: &LongFileAnalysisReport, min_lines: usize) {
    if report.files.is_empty() {
        println!("No oversized or explicit files matched for long-file analysis.");
        return;
    }

    for file in &report.files {
        if file.line_count < min_lines {
            continue;
        }
        println!(
            "{} [{}] {} lines (budget {}, commits {})",
            file.file_path, file.language, file.line_count, file.budget_limit, file.commit_count
        );
        if !file.budget_reason.is_empty() {
            println!("  budget reason: {}", file.budget_reason);
        }
        for class in &file.classes {
            println!(
                "  class {} [{}-{}] methods={}",
                class.qualified_name, class.start_line, class.end_line, class.method_count
            );
        }
        for function in &file.functions {
            println!(
                "  {} {} [{}-{}] comments={} commits={}",
                function.kind,
                function.qualified_name,
                function.start_line,
                function.end_line,
                function.comment_count,
                function.commit_count
            );
        }
        for warning in &file.warnings {
            println!("  warning {}: {}", warning.code, warning.summary);
        }
    }
}

pub(crate) fn print_release_trigger_report(report: &ReleaseTriggerReport) {
    println!("Release trigger report");
    println!("- blocked: {}", if report.blocked { "yes" } else { "no" });
    println!(
        "- human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!("- manifest: {}", report.manifest_path);
    if let Some(path) = &report.baseline_manifest_path {
        println!("- baseline manifest: {path}");
    }
    println!("- artifacts: {}", report.artifacts.len());
    println!("- changed files: {}", report.changed_files.len());
    if report.triggers.is_empty() {
        println!("- triggers: none");
        return;
    }
    println!("- triggers:");
    for trigger in &report.triggers {
        println!(
            "  - {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("    - {reason}");
        }
    }
}

pub(crate) fn print_review_trigger_report(report: &ReviewTriggerReport) {
    println!(
        "human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!("base: {}", report.base);
    println!("changed files: {}", report.changed_files.len());
    println!("triggers: {}", report.triggers.len());
    for trigger in &report.triggers {
        println!(
            "- {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("  - {reason}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::hook_long_file_summary_lines;
    use entrix::long_file::{
        LongFileAnalysisReport, LongFileClassReport, LongFileCommentSpan, LongFileFileReport,
        LongFileFunctionReport, LongFileWarning,
    };

    fn sample_function(name: &str, start_line: usize, end_line: usize) -> LongFileFunctionReport {
        LongFileFunctionReport {
            name: name.to_string(),
            qualified_name: name.to_string(),
            file_path: "src/app.ts".to_string(),
            start_line,
            end_line,
            line_count: end_line - start_line + 1,
            commit_count: 0,
            comment_count: 0,
            comments: Vec::new(),
            kind: "function".to_string(),
            parent_class_name: None,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn hook_long_file_summary_formats_symbols() {
        let report = LongFileAnalysisReport {
            status: "ok".to_string(),
            base: "HEAD".to_string(),
            summary: None,
            files: vec![LongFileFileReport {
                file_path: "src/app.ts".to_string(),
                language: "typescript".to_string(),
                line_count: 1201,
                budget_limit: 1000,
                budget_reason: "legacy hotspot".to_string(),
                over_budget: true,
                commit_count: 0,
                classes: vec![LongFileClassReport {
                    name: "AppController".to_string(),
                    qualified_name: "AppController".to_string(),
                    file_path: "src/app.ts".to_string(),
                    start_line: 10,
                    end_line: 120,
                    line_count: 111,
                    commit_count: 0,
                    comment_count: 0,
                    comments: Vec::new(),
                    method_count: 2,
                    methods: vec![
                        sample_function("handleRequest", 20, 80),
                        sample_function("renderView", 82, 110),
                    ],
                    warnings: vec![LongFileWarning {
                        code: "comment_review".to_string(),
                        summary: "review hotspot".to_string(),
                        file_path: "src/app.ts".to_string(),
                        qualified_name: "AppController".to_string(),
                        name: "AppController".to_string(),
                        symbol_kind: "Class".to_string(),
                        start_line: 10,
                        end_line: 120,
                        line_count: 111,
                        commit_count: 0,
                        comment_count: 1,
                        comment_spans: vec![LongFileCommentSpan {
                            start_line: 12,
                            end_line: 15,
                            placement: "leading".to_string(),
                        }],
                    }],
                }],
                functions: vec![sample_function("bootstrap", 130, 170)],
                warnings: Vec::new(),
            }],
        };

        let lines = hook_long_file_summary_lines(&report);
        let output = lines.join("\n");

        assert!(output.contains("Structure summary (tree-sitter symbols):"));
        assert!(output.contains("- src/app.ts"));
        assert!(output.contains("class AppController (L10-L120, methods=2)"));
        assert!(output.contains("method handleRequest (L20-L80)"));
        assert!(output.contains("functions: bootstrap (L130-L170)"));
    }

    #[test]
    fn hook_long_file_summary_reports_empty_analysis() {
        let report = LongFileAnalysisReport {
            status: "ok".to_string(),
            base: "HEAD".to_string(),
            files: Vec::new(),
            summary: None,
        };

        assert_eq!(
            hook_long_file_summary_lines(&report),
            vec!["Structure summary unavailable: no supported files for structural analysis."
                .to_string()]
        );
    }
}
