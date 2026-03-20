"""Tests for routa_fitness.review_trigger."""

from __future__ import annotations

import textwrap
from pathlib import Path

from routa_fitness.review_trigger import (
    DiffStats,
    evaluate_review_triggers,
    load_review_triggers,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_load_review_triggers(tmp_path: Path):
    config = tmp_path / "review-triggers.yaml"
    config.write_text(
        textwrap.dedent(
            """\
            review_triggers:
              - name: high_risk_directory_change
                type: changed_paths
                paths:
                  - src/core/acp/**
                severity: high
                action: require_human_review
              - name: oversized_change
                type: diff_size
                max_files: 5
                max_added_lines: 100
                max_deleted_lines: 20
            """
        ),
        encoding="utf-8",
    )

    rules = load_review_triggers(config)

    assert len(rules) == 2
    assert rules[0].paths == ("src/core/acp/**",)
    assert rules[1].max_files == 5


def test_evaluate_review_triggers_matches_changed_paths():
    report = evaluate_review_triggers(
        load_review_triggers(REPO_ROOT / "docs" / "fitness" / "review-triggers.yaml"),
        ["src/core/acp/agent.ts", "src/app/page.tsx"],
        DiffStats(file_count=2, added_lines=20, deleted_lines=5),
        base="HEAD~1",
    )

    assert report.human_review_required is True
    assert report.triggers[0].name == "high_risk_directory_change"
    assert "src/core/acp/agent.ts" in report.triggers[0].reasons[0]


def test_evaluate_review_triggers_matches_diff_size():
    report = evaluate_review_triggers(
        load_review_triggers(REPO_ROOT / "docs" / "fitness" / "review-triggers.yaml"),
        ["src/app/page.tsx"],
        DiffStats(file_count=20, added_lines=700, deleted_lines=10),
        base="HEAD~1",
    )

    assert report.human_review_required is True
    names = {trigger.name for trigger in report.triggers}
    assert "oversized_change" in names


def test_evaluate_review_triggers_returns_clean_report():
    report = evaluate_review_triggers(
        load_review_triggers(REPO_ROOT / "docs" / "fitness" / "review-triggers.yaml"),
        ["src/app/page.tsx"],
        DiffStats(file_count=1, added_lines=10, deleted_lines=2),
        base="HEAD~1",
    )

    assert report.human_review_required is False
    assert report.triggers == ()
