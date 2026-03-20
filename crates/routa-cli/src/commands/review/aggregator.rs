//! Evidence and finding aggregation helpers for `routa review`.

use std::collections::{HashMap, HashSet};

use super::shared::{SecurityRootFinding, SecuritySpecialistOutput, SecuritySpecialistReport};

pub(crate) fn parse_specialist_output(raw_output: &str) -> Option<SecuritySpecialistOutput> {
    let trimmed = raw_output.trim();
    if let Ok(parsed) = serde_json::from_str::<SecuritySpecialistOutput>(trimmed) {
        return Some(parsed);
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    let candidate = &trimmed[start..=end];
    serde_json::from_str(candidate).ok()
}

pub(crate) fn merge_specialist_findings(
    pre_merged_findings: &[SecurityRootFinding],
    specialist_reports: &[SecuritySpecialistReport],
) -> Vec<SecurityRootFinding> {
    let mut merged: HashMap<String, SecurityRootFinding> = HashMap::new();

    for finding in pre_merged_findings {
        let key = finding.root_cause.to_lowercase();
        merged.insert(key, finding.clone());
    }

    for report in specialist_reports {
        for finding in &report.findings {
            let key = finding.root_cause.to_lowercase();
            match merged.get_mut(&key) {
                Some(existing) => {
                    existing.affected_locations = merge_unique_strings(
                        &existing.affected_locations,
                        &finding.affected_locations,
                    );
                    existing.attack_path = if finding.attack_path.len() > existing.attack_path.len()
                    {
                        finding.attack_path.clone()
                    } else {
                        existing.attack_path.clone()
                    };
                    existing.recommended_fix =
                        if finding.recommended_fix.len() > existing.recommended_fix.len() {
                            finding.recommended_fix.clone()
                        } else {
                            existing.recommended_fix.clone()
                        };
                    existing.related_variants =
                        merge_unique_strings(&existing.related_variants, &finding.related_variants);
                    existing.guardrails_present = merge_unique_strings(
                        &existing.guardrails_present,
                        &finding.guardrails_present,
                    );
                    existing.why_it_matters =
                        if finding.why_it_matters.len() > existing.why_it_matters.len() {
                            finding.why_it_matters.clone()
                        } else {
                            existing.why_it_matters.clone()
                        };
                    existing.confidence = higher_confidence(
                        existing.confidence.as_deref(),
                        finding.confidence.as_deref(),
                    );
                    existing.severity = max_severity(&existing.severity, &finding.severity);
                }
                None => {
                    merged.insert(key, finding.clone());
                }
            }
        }
    }

    merged.into_values().collect::<Vec<_>>()
}

fn merge_unique_strings(target: &[String], additions: &[String]) -> Vec<String> {
    let mut merged = target.to_vec();
    let mut existing = merged
        .iter()
        .map(|entry| entry.to_lowercase())
        .collect::<HashSet<_>>();
    for item in additions {
        let key = item.to_lowercase();
        if existing.insert(key) {
            merged.push(item.clone());
        }
    }
    merged
}

fn higher_confidence(current: Option<&str>, candidate: Option<&str>) -> Option<String> {
    let ranked = ["", "LOW", "MEDIUM", "HIGH", "VERY_HIGH", "CONFIRMED"];
    let score = |value: &str| {
        ranked
            .iter()
            .position(|candidate| value.eq_ignore_ascii_case(candidate))
            .unwrap_or(0)
    };
    match (current, candidate) {
        (None, Some(value)) => Some(value.to_string()),
        (Some(current), None) => Some(current.to_string()),
        (Some(current), Some(candidate)) => {
            if score(candidate) >= score(current) {
                Some(candidate.to_string())
            } else {
                Some(current.to_string())
            }
        }
        _ => None,
    }
}

fn max_severity(current: &str, candidate: &str) -> String {
    let weights = ["", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
    let rank = |value: &str| {
        let upper = value.to_uppercase();
        weights
            .iter()
            .position(|entry| entry == &upper)
            .unwrap_or(0)
    };
    if rank(candidate) >= rank(current) {
        candidate.to_string()
    } else {
        current.to_string()
    }
}
