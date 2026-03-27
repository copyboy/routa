use super::support::{format_percent, level_change_label};
use super::types::{HarnessFluencyReport, LevelChange};

pub fn format_text_report(report: &HarnessFluencyReport) -> String {
    let next_level_readiness_line = if report.next_level_name.is_some()
        && report.next_level_readiness.is_none()
        && report.blocking_target_level == Some(report.overall_level.clone())
    {
        format!(
            "Next Level Readiness: Blocked until {} is stable",
            report.overall_level_name
        )
    } else {
        format!(
            "Next Level Readiness: {}",
            format_percent(report.next_level_readiness)
        )
    };
    let blocking_header = match &report.blocking_target_level_name {
        Some(name) if report.blocking_target_level == Some(report.overall_level.clone()) => {
            format!("Blocking Gaps To Stabilize {name}:")
        }
        Some(name) => format!("Blocking Gaps To {name}:"),
        None => "Blocking Gaps: none".to_string(),
    };

    let mut lines = vec![
        "HARNESS FLUENCY REPORT".to_string(),
        String::new(),
        format!("Repository: {}", report.repo_root),
        format!("Profile: {}", report.profile),
        format!("Model Version: {}", report.model_version),
        format!("Overall Level: {}", report.overall_level_name),
        format!(
            "Current Level Readiness: {}",
            format_percent(Some(report.current_level_readiness))
        ),
        format!(
            "Next Level: {}",
            report
                .next_level_name
                .clone()
                .unwrap_or_else(|| "Reached top level".to_string())
        ),
        next_level_readiness_line,
        String::new(),
        "Dimensions:".to_string(),
    ];

    let mut dimensions = report.dimensions.values().cloned().collect::<Vec<_>>();
    dimensions.sort_by(|left, right| left.name.cmp(&right.name));
    for dimension in dimensions {
        lines.push(format!(
            "- {}: {} ({})",
            dimension.name,
            dimension.level_name,
            format_percent(Some(dimension.score))
        ));
    }

    lines.push(String::new());
    lines.push(blocking_header);
    if report.blocking_target_level_name.is_some() {
        if report.blocking_criteria.is_empty() {
            lines.push("- None".to_string());
        } else {
            for criterion in &report.blocking_criteria {
                lines.push(format!("- {} — {}", criterion.id, criterion.evidence_hint));
            }
        }
    }

    lines.push(String::new());
    lines.push("Recommended Next Actions:".to_string());
    if report.recommendations.is_empty() {
        lines.push("- None".to_string());
    } else {
        for recommendation in &report.recommendations {
            lines.push(format!("- {}", recommendation.action));
        }
    }

    if let Some(comparison) = &report.comparison {
        lines.push(String::new());
        lines.push("Comparison To Last Snapshot:".to_string());
        lines.push(format!(
            "- Overall: {} ({} -> {})",
            level_change_label(&comparison.overall_change),
            comparison.previous_overall_level,
            report.overall_level
        ));
        lines.push(format!(
            "- Dimensions changed: {}",
            comparison
                .dimension_changes
                .iter()
                .filter(|entry| entry.change != LevelChange::Same)
                .count()
        ));
        lines.push(format!(
            "- Criteria changed: {}",
            comparison.criteria_changes.len()
        ));
    }

    lines.push(String::new());
    lines.push(format!("Snapshot: {}", report.snapshot_path));
    lines.join("\n")
}
