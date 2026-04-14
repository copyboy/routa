use crate::{
    parse_scope_filter, status_exit_code, AnalyzeArgs, AnalyzeCommand, Cli, Command, ExecutionScope,
    GraphArgs, GraphCommand, GraphStatsArgs, HookArgs, HookCommand, StreamMode,
};
use clap::Parser;

#[test]
fn graph_stats_accepts_json_flag() {
    let cli = Cli::parse_from(["entrix", "graph", "stats", "--json"]);
    match cli.command {
        Some(Command::Graph(GraphArgs {
            command: Some(GraphCommand::Stats(GraphStatsArgs { json })),
        })) => assert!(json),
        _ => panic!("expected graph stats command"),
    }
}

#[test]
fn unavailable_status_maps_to_exit_code_one() {
    assert_eq!(status_exit_code("unavailable"), 1);
    assert_eq!(status_exit_code("ok"), 0);
}

#[test]
fn graph_parent_command_parses_without_subcommand() {
    let cli = Cli::parse_from(["entrix", "graph"]);
    match cli.command {
        Some(Command::Graph(GraphArgs { command: None })) => {}
        _ => panic!("expected graph command without subcommand"),
    }
}

#[test]
fn no_command_parses_without_subcommand() {
    let cli = Cli::parse_from(["entrix"]);
    assert!(cli.command.is_none());
}

#[test]
fn run_defaults() {
    let cli = Cli::parse_from(["entrix", "run"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert!(args.tier.is_none());
            assert!(args.tier_positional.is_none());
            assert!(!args.parallel);
            assert!(!args.dry_run);
            assert!(!args.verbose);
            assert_eq!(args.stream, "failures");
            assert_eq!(args.format, "text");
            assert_eq!(args.min_score, 80.0);
            assert!(args.scope.is_none());
            assert!(!args.changed_only);
            assert!(args.files.is_empty());
            assert_eq!(args.base, "HEAD");
            assert!(args.dimensions.is_empty());
            assert!(args.metrics.is_empty());
            assert!(!args.json);
            assert!(args.output.is_none());
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_all_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "run",
        "--tier",
        "fast",
        "--parallel",
        "--dry-run",
        "--verbose",
        "--stream",
        "all",
        "--format",
        "rich",
        "--min-score",
        "90.0",
        "--scope",
        "ci",
        "--changed-only",
        "--files",
        "a.rs",
        "--base",
        "main",
        "--dimension",
        "security",
        "--metric",
        "lint",
        "--json",
        "--output",
        "report.json",
    ]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(args.tier.as_deref(), Some("fast"));
            assert!(args.parallel);
            assert!(args.dry_run);
            assert!(args.verbose);
            assert_eq!(args.stream, "all");
            assert_eq!(args.format, "rich");
            assert_eq!(args.min_score, 90.0);
            assert_eq!(args.scope.as_deref(), Some("ci"));
            assert!(args.changed_only);
            assert_eq!(args.files, vec!["a.rs"]);
            assert_eq!(args.base, "main");
            assert_eq!(args.dimensions, vec!["security"]);
            assert_eq!(args.metrics, vec!["lint"]);
            assert!(args.json);
            assert_eq!(args.output.as_deref(), Some("report.json"));
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_stream_without_value_defaults_to_all() {
    let cli = Cli::parse_from(["entrix", "run", "--stream", "--dry-run"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(args.stream, "all");
            assert!(args.dry_run);
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_stream_with_explicit_value() {
    let cli = Cli::parse_from(["entrix", "run", "--stream", "off"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(args.stream, "off");
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn run_defaults_scope_to_local() {
    let cli = Cli::parse_from(["entrix", "run"]);
    match cli.command {
        Some(Command::Run(args)) => {
            assert!(args.scope.is_none());
            let resolved = args
                .scope
                .as_deref()
                .and_then(parse_scope_filter)
                .or(Some(ExecutionScope::Local));
            assert_eq!(resolved, Some(ExecutionScope::Local));
        }
        _ => panic!("expected run command"),
    }
}

#[test]
fn validate_parses() {
    let cli = Cli::parse_from(["entrix", "validate", "--json"]);
    match cli.command {
        Some(Command::Validate(args)) => assert!(args.json),
        _ => panic!("expected validate command"),
    }
}

#[test]
fn review_trigger_defaults() {
    let cli = Cli::parse_from(["entrix", "review-trigger"]);
    match cli.command {
        Some(Command::ReviewTrigger(args)) => {
            assert!(args.files.is_empty());
            assert_eq!(args.base, "HEAD~1");
            assert!(args.config.is_none());
            assert!(!args.fail_on_trigger);
            assert!(!args.json);
        }
        _ => panic!("expected review-trigger command"),
    }
}

#[test]
fn release_trigger_defaults() {
    let cli = Cli::parse_from(["entrix", "release-trigger", "--manifest", "manifest.json"]);
    match cli.command {
        Some(Command::ReleaseTrigger(args)) => {
            assert!(args.files.is_empty());
            assert_eq!(args.base, "HEAD~1");
            assert_eq!(args.manifest, "manifest.json");
            assert!(args.baseline_manifest.is_none());
            assert!(args.config.is_none());
            assert!(!args.fail_on_trigger);
            assert!(!args.json);
        }
        _ => panic!("expected release-trigger command"),
    }
}

#[test]
fn hook_file_length_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "hook",
        "file-length",
        "--config",
        "budgets.json",
        "--staged-only",
        "--strict-limit",
    ]);
    match cli.command {
        Some(Command::Hook(HookArgs {
            command: Some(HookCommand::FileLength(args)),
        })) => {
            assert_eq!(args.config, "budgets.json");
            assert!(args.staged_only);
            assert!(args.strict_limit);
            assert!(!args.changed_only);
            assert!(!args.overrides_only);
        }
        _ => panic!("expected hook file-length command"),
    }
}

#[test]
fn analyze_long_file_flags() {
    let cli = Cli::parse_from([
        "entrix",
        "analyze",
        "long-file",
        "--files",
        "a.rs",
        "--base",
        "main",
        "--strict-limit",
        "--json",
    ]);
    match cli.command {
        Some(Command::Analyze(AnalyzeArgs {
            command: Some(AnalyzeCommand::LongFile(args)),
        })) => {
            assert_eq!(args.files, vec!["a.rs"]);
            assert_eq!(args.base, "main");
            assert!(args.strict_limit);
            assert!(args.json);
        }
        _ => panic!("expected analyze long-file command"),
    }
}

#[test]
fn analyze_long_file_positional_paths() {
    let cli = Cli::parse_from(["entrix", "analyze", "long-file", "src/a.ts", "src/b.py"]);
    match cli.command {
        Some(Command::Analyze(AnalyzeArgs {
            command: Some(AnalyzeCommand::LongFile(args)),
        })) => {
            assert_eq!(args.paths, vec!["src/a.ts", "src/b.py"]);
        }
        _ => panic!("expected analyze long-file command"),
    }
}

#[test]
fn analyze_long_file_dedup_merges_files_and_paths() {
    let files = vec!["src/b.py".to_string(), "src/a.ts".to_string()];
    let paths = vec!["src/a.ts".to_string(), "src/c.rs".to_string()];
    let mut seen = std::collections::HashSet::new();
    let merged: Vec<String> = files
        .iter()
        .chain(paths.iter())
        .filter(|f| seen.insert((*f).clone()))
        .cloned()
        .collect();
    assert_eq!(merged, vec!["src/b.py", "src/a.ts", "src/c.rs"]);
}

#[test]
fn stream_mode_parse_parity() {
    assert_eq!(StreamMode::parse("all"), StreamMode::All);
    assert_eq!(StreamMode::parse("off"), StreamMode::Off);
    assert_eq!(StreamMode::parse("failures"), StreamMode::Failures);
    assert_eq!(StreamMode::parse("unknown"), StreamMode::Failures);
}

#[test]
fn scope_filter_parse_parity() {
    assert_eq!(parse_scope_filter("local"), Some(ExecutionScope::Local));
    assert_eq!(parse_scope_filter("ci"), Some(ExecutionScope::Ci));
    assert_eq!(parse_scope_filter("staging"), Some(ExecutionScope::Staging));
    assert_eq!(
        parse_scope_filter("prod_observation"),
        Some(ExecutionScope::ProdObservation)
    );
    assert_eq!(parse_scope_filter("unknown"), None);
}
