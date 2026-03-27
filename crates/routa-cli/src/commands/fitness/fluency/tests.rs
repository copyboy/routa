use super::model::load_fluency_model;
use super::types::{CriterionStatus, LevelChange};
use super::{evaluate_harness_fluency, format_text_report, EvaluateOptions};
use serde_json::json;
use std::fs::{create_dir_all, write};
use std::path::Path;
use tempfile::tempdir;

fn write_json(path: &Path, value: serde_json::Value) {
    write(
        path,
        format!("{}\n", serde_json::to_string_pretty(&value).unwrap()),
    )
    .unwrap();
}

#[test]
fn loads_generic_model_and_enforces_two_criteria_per_cell() {
    let model = load_fluency_model(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("docs/fitness/harness-fluency.model.yaml")
            .as_path(),
    )
    .expect("model");

    assert_eq!(model.levels.len(), 5);
    assert_eq!(model.dimensions.len(), 5);
    assert_eq!(model.criteria.len(), 50);

    for level in &model.levels {
        for dimension in &model.dimensions {
            let count = model
                .criteria
                .iter()
                .filter(|criterion| {
                    criterion.level == level.id && criterion.dimension == dimension.id
                })
                .count();
            assert!(
                count >= 2,
                "missing coverage for {} × {}",
                dimension.id,
                level.id
            );
        }
    }
}

#[test]
fn evaluates_snapshots_commands_and_manual_attestation() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    create_dir_all(repo_root.join("docs/issues")).unwrap();
    create_dir_all(repo_root.join(".claude/skills")).unwrap();

    write(repo_root.join(".claude/skills/README.md"), "skill\n").unwrap();
    write(repo_root.join("docs/issues/one.md"), "# one\n").unwrap();
    write(repo_root.join("docs/issues/two.md"), "# two\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.skill_dir
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: skills matter
    recommended_action: add skills
    evidence_hint: .claude/skills
    detector:
      type: any_file_exists
      paths:
        - .claude/skills
        - .agents/skills
  - id: collaboration.awareness.issue_history
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: history matters
    recommended_action: add issues
    evidence_hint: docs/issues/*.md
    detector:
      type: glob_count
      patterns:
        - docs/issues/*.md
      min: 2
  - id: collaboration.assisted.command_exit
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: command checks matter
    recommended_action: add command checks
    evidence_hint: node -p 1
    detector:
      type: command_exit_code
      command: node -p 1
      expectedExitCode: 0
  - id: collaboration.assisted.command_output
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: output checks matter
    recommended_action: add output checks
    evidence_hint: node -p process.platform
    detector:
      type: command_output_regex
      command: node -p process.platform
      pattern: ^(darwin|linux|win32)$
      flags: ""
  - id: collaboration.assisted.attestation
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: manual checks matter
    recommended_action: document manual checks
    evidence_hint: manual prompt
    detector:
      type: manual_attestation
      prompt: Confirm org process
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    assert_eq!(report.overall_level, "assisted");
    assert!(report.criteria.iter().any(|criterion| {
        criterion.id == "collaboration.assisted.command_exit"
            && criterion.status == CriterionStatus::Pass
    }));
    assert!(report.criteria.iter().any(|criterion| {
        criterion.id == "collaboration.assisted.attestation"
            && criterion.status == CriterionStatus::Skipped
    }));
}

#[test]
fn ignores_generated_and_workspace_noise_in_glob_detectors() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    create_dir_all(repo_root.join(".routa/repos/demo/tests")).unwrap();
    create_dir_all(repo_root.join(".next-page-snapshots/dev/server/chunks")).unwrap();
    create_dir_all(repo_root.join("frontend/_next/static/chunks")).unwrap();
    create_dir_all(repo_root.join(".worktrees/demo/tests")).unwrap();
    create_dir_all(repo_root.join("tests")).unwrap();

    write(repo_root.join("README.md"), "# repo\n").unwrap();
    write(
        repo_root.join(".routa/repos/demo/tests/fake.spec.ts"),
        "fake\n",
    )
    .unwrap();
    write(
        repo_root.join(".worktrees/demo/tests/fake.spec.ts"),
        "fake\n",
    )
    .unwrap();
    write(
        repo_root.join(".next-page-snapshots/dev/server/chunks/runtime.ts"),
        "export class RuntimeManager {}\n",
    )
    .unwrap();
    write(
        repo_root.join("frontend/_next/static/chunks/runtime.js"),
        "export class RuntimeManager {}\n",
    )
    .unwrap();
    write(repo_root.join("tests/app.spec.ts"), "real\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.readme
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: readme
    recommended_action: readme
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.readme_text
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: readme text
    recommended_action: readme text
    evidence_hint: README.md
    detector:
      type: file_contains_regex
      path: README.md
      pattern: repo
      flags: i
  - id: collaboration.assisted.real_tests
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: real tests
    recommended_action: real tests
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_count
      patterns:
        - tests/**/*.spec.ts
        - .routa/**/*.spec.ts
        - .worktrees/**/*.spec.ts
      min: 2
  - id: collaboration.assisted.real_runtime
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: runtime
    recommended_action: runtime
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_contains_regex
      patterns:
        - tests/**/*.spec.ts
        - .next-page-snapshots/**/*.ts
        - frontend/_next/**/*.js
      pattern: RuntimeManager|real
      flags: i
      minMatches: 1
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let count = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.assisted.real_tests")
        .unwrap();
    assert_eq!(count.status, CriterionStatus::Fail);
    assert_eq!(count.detail, "matched 1 paths (min 2)");

    let regex = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.assisted.real_runtime")
        .unwrap();
    assert_eq!(regex.status, CriterionStatus::Pass);
    assert_eq!(regex.evidence, vec!["tests/app.spec.ts".to_string()]);
}

#[test]
fn compares_against_previous_snapshot() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("AGENTS.md"), "# contract\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.path
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: path
    recommended_action: path
    evidence_hint: AGENTS.md
    detector:
      type: any_file_exists
      paths:
        - AGENTS.md
  - id: collaboration.assisted.script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: script
    recommended_action: script
    evidence_hint: package.json
    detector:
      type: file_exists
      path: package.json
  - id: collaboration.assisted.path
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: path
    recommended_action: path
    evidence_hint: package.json
    detector:
      type: any_file_exists
      paths:
        - package.json
"#,
    )
    .unwrap();
    write_json(
        &snapshot_path,
        json!({
            "modelVersion": 1,
            "modelPath": model_path.display().to_string(),
            "profile": "generic",
            "repoRoot": repo_root.display().to_string(),
            "generatedAt": "2026-03-26T00:00:00.000Z",
            "snapshotPath": snapshot_path.display().to_string(),
            "overallLevel": "assisted",
            "overallLevelName": "Assisted",
            "currentLevelReadiness": 1.0,
            "nextLevel": null,
            "nextLevelName": null,
            "nextLevelReadiness": null,
            "blockingTargetLevel": null,
            "blockingTargetLevelName": null,
            "dimensions": {
                "collaboration": {
                    "dimension": "collaboration",
                    "name": "Collaboration",
                    "level": "assisted",
                    "levelName": "Assisted",
                    "levelIndex": 1,
                    "score": 1.0,
                    "nextLevel": null,
                    "nextLevelName": null,
                    "nextLevelProgress": null
                }
            },
            "cells": [],
            "criteria": [
                {
                    "id": "collaboration.awareness.file",
                    "level": "awareness",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": true,
                    "status": "pass",
                    "detectorType": "file_exists",
                    "detail": "found AGENTS.md",
                    "evidence": ["AGENTS.md"],
                    "whyItMatters": "file",
                    "recommendedAction": "file",
                    "evidenceHint": "AGENTS.md"
                },
                {
                    "id": "collaboration.awareness.path",
                    "level": "awareness",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": false,
                    "status": "pass",
                    "detectorType": "any_file_exists",
                    "detail": "found AGENTS.md",
                    "evidence": ["AGENTS.md"],
                    "whyItMatters": "path",
                    "recommendedAction": "path",
                    "evidenceHint": "AGENTS.md"
                },
                {
                    "id": "collaboration.assisted.path",
                    "level": "assisted",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": false,
                    "status": "pass",
                    "detectorType": "any_file_exists",
                    "detail": "found package.json",
                    "evidence": ["package.json"],
                    "whyItMatters": "path",
                    "recommendedAction": "path",
                    "evidenceHint": "package.json"
                },
                {
                    "id": "collaboration.assisted.script",
                    "level": "assisted",
                    "dimension": "collaboration",
                    "weight": 1,
                    "critical": true,
                    "status": "pass",
                    "detectorType": "file_exists",
                    "detail": "found package.json",
                    "evidence": ["package.json"],
                    "whyItMatters": "script",
                    "recommendedAction": "script",
                    "evidenceHint": "package.json"
                }
            ],
            "blockingCriteria": [],
            "recommendations": [],
            "comparison": null
        }),
    );

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        snapshot_path,
        compare_last: true,
        save: false,
    })
    .expect("report");

    assert_eq!(report.overall_level, "awareness");
    assert_eq!(
        report.comparison.as_ref().unwrap().overall_change,
        LevelChange::Down
    );
    let text = format_text_report(&report);
    assert!(text.contains("HARNESS FLUENCY REPORT"));
    assert!(text.contains("Comparison To Last Snapshot:"));
}
