use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BudgetOverride {
    pub path: String,
    pub max_lines: usize,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FileBudgetConfig {
    pub default_max_lines: usize,
    pub include_roots: Vec<String>,
    pub extensions: Vec<String>,
    #[serde(default)]
    pub extension_max_lines: HashMap<String, usize>,
    #[serde(default)]
    pub excluded_parts: Vec<String>,
    #[serde(default)]
    pub overrides: Vec<BudgetOverride>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileBudgetViolation {
    pub path: String,
    pub line_count: usize,
    pub max_lines: usize,
    pub reason: String,
}

pub fn default_config() -> FileBudgetConfig {
    FileBudgetConfig {
        default_max_lines: 1000,
        include_roots: vec!["src".into(), "apps".into(), "crates".into()],
        extensions: vec![".ts".into(), ".tsx".into(), ".rs".into()],
        extension_max_lines: [
            (".rs".to_string(), 800usize),
            (".ts".to_string(), 1000usize),
            (".tsx".to_string(), 1000usize),
        ]
        .into_iter()
        .collect(),
        excluded_parts: vec![
            "/node_modules/".into(),
            "/target/".into(),
            "/.next/".into(),
            "/_next/".into(),
            "/bundled/".into(),
        ],
        overrides: Vec::new(),
    }
}

pub fn load_config(config_path: &Path) -> FileBudgetConfig {
    fs::read_to_string(config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<FileBudgetConfig>(&raw).ok())
        .unwrap_or_else(default_config)
}

pub fn is_tracked_source_file(relative_path: &str, config: &FileBudgetConfig) -> bool {
    let matches_root = config.include_roots.iter().any(|root| {
        relative_path == root || relative_path.starts_with(&format!("{root}/"))
    });
    if !matches_root {
        return false;
    }
    let matches_extension = config
        .extensions
        .iter()
        .any(|extension| relative_path.ends_with(extension));
    if !matches_extension {
        return false;
    }
    !config
        .excluded_parts
        .iter()
        .any(|part| relative_path.contains(part))
}

pub fn resolve_budget(relative_path: &str, config: &FileBudgetConfig) -> (usize, String) {
    for override_entry in &config.overrides {
        if override_entry.path == relative_path {
            return (override_entry.max_lines, override_entry.reason.clone());
        }
    }

    let extension = Path::new(relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();
    let max_lines = config
        .extension_max_lines
        .get(&extension)
        .copied()
        .unwrap_or(config.default_max_lines);
    (max_lines, String::new())
}

pub fn list_changed_files(repo_root: &Path, base: &str, staged_only: bool) -> Result<Vec<String>, String> {
    let mut command = Command::new("git");
    command.current_dir(repo_root);
    command.arg("diff");
    if staged_only {
        command.arg("--cached");
    }
    command.args(["--name-only", "--diff-filter=ACMR"]);
    if !staged_only {
        command.arg(base);
    }
    command.arg("--");
    for root in config_roots_for_git_diff(repo_root) {
        command.arg(root);
    }

    let output = command
        .output()
        .map_err(|error| format!("failed to run git diff: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn config_roots_for_git_diff(repo_root: &Path) -> Vec<&'static str> {
    let roots = ["src", "apps", "crates", "scripts", "tests", "e2e", "tools"];
    roots
        .into_iter()
        .filter(|root| repo_root.join(root).exists())
        .collect()
}

pub fn resolve_paths(
    repo_root: &Path,
    config: &FileBudgetConfig,
    explicit_paths: &[String],
    base: &str,
    staged_only: bool,
) -> Result<Vec<String>, String> {
    if !explicit_paths.is_empty() {
        return Ok(explicit_paths.to_vec());
    }

    if staged_only {
        return list_changed_files(repo_root, base, true);
    }

    let mut collected = Vec::new();
    for root in &config.include_roots {
        let base_dir = repo_root.join(root);
        if !base_dir.exists() {
            continue;
        }
        walk_files(repo_root, &base_dir, &mut collected);
    }
    Ok(collected)
}

fn walk_files(repo_root: &Path, dir: &Path, collected: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(repo_root, &path, collected);
            continue;
        }
        if let Ok(relative) = normalize_repo_path(&path, repo_root) {
            collected.push(relative);
        }
    }
}

fn normalize_repo_path(path: &Path, repo_root: &Path) -> Result<String, String> {
    let absolute = fs::canonicalize(path)
        .map_err(|error| format!("failed to canonicalize {}: {error}", path.display()))?;
    let root = fs::canonicalize(repo_root)
        .map_err(|error| format!("failed to canonicalize {}: {error}", repo_root.display()))?;
    let relative = absolute
        .strip_prefix(&root)
        .map_err(|error| format!("failed to strip repo prefix: {error}"))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub fn evaluate_paths(
    repo_root: &Path,
    relative_paths: &[String],
    config: &FileBudgetConfig,
    use_head_ratchet: bool,
) -> Vec<FileBudgetViolation> {
    let mut violations = Vec::new();
    for relative_path in BTreeSet::from_iter(relative_paths.iter().cloned()) {
        if !is_tracked_source_file(&relative_path, config) {
            continue;
        }

        let file_path = repo_root.join(&relative_path);
        if !file_path.is_file() {
            continue;
        }

        let (configured_max_lines, mut reason) = resolve_budget(&relative_path, config);
        let mut max_lines = configured_max_lines;
        if use_head_ratchet {
            if let Some(baseline_lines) = count_head_lines(repo_root, &relative_path) {
                max_lines = max_lines.max(baseline_lines);
                if baseline_lines > configured_max_lines && reason.is_empty() {
                    reason = format!("legacy hotspot frozen at HEAD baseline ({baseline_lines} lines)");
                }
            }
        }

        let line_count = count_lines(&file_path);
        if line_count > max_lines {
            violations.push(FileBudgetViolation {
                path: relative_path,
                line_count,
                max_lines,
                reason,
            });
        }
    }
    violations
}

pub fn checked_count(relative_paths: &[String], config: &FileBudgetConfig) -> usize {
    BTreeSet::from_iter(relative_paths.iter().cloned())
        .into_iter()
        .filter(|path| is_tracked_source_file(path, config))
        .count()
}

fn count_lines(file_path: &Path) -> usize {
    fs::read_to_string(file_path)
        .map(|content| content.lines().count())
        .unwrap_or(0)
}

fn count_head_lines(repo_root: &Path, relative_path: &str) -> Option<usize> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["show", &format!("HEAD:{relative_path}")])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).lines().count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn missing_config_falls_back_to_defaults() {
        let dir = tempdir().unwrap();
        let config = load_config(&dir.path().join("missing.json"));
        assert_eq!(config.default_max_lines, 1000);
        assert!(config.include_roots.contains(&"src".to_string()));
    }

    #[test]
    fn tracked_source_file_checks_roots_extensions_and_exclusions() {
        let config = default_config();
        assert!(is_tracked_source_file("src/app.ts", &config));
        assert!(is_tracked_source_file("crates/demo/src/lib.rs", &config));
        assert!(!is_tracked_source_file("docs/readme.md", &config));
        assert!(!is_tracked_source_file("src/node_modules/pkg/index.ts", &config));
    }

    #[test]
    fn evaluate_paths_applies_budgets() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("src").join("app.ts");
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        let mut handle = fs::File::create(&file_path).unwrap();
        for _ in 0..5 {
            writeln!(handle, "const value = 1;").unwrap();
        }

        let config = FileBudgetConfig {
            default_max_lines: 3,
            include_roots: vec!["src".into()],
            extensions: vec![".ts".into()],
            extension_max_lines: HashMap::new(),
            excluded_parts: Vec::new(),
            overrides: Vec::new(),
        };

        let violations = evaluate_paths(dir.path(), &[String::from("src/app.ts")], &config, false);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].path, "src/app.ts");
    }
}
