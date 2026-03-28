//! Shell runner — execute metric commands via subprocess.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use regex::Regex;

use crate::model::{Gate, Metric, MetricResult, ResultState};

/// Callback type for progress events.
pub type ProgressCallback = Box<dyn Fn(&str, &Metric, Option<&MetricResult>) + Send + Sync>;

/// Executes Metric commands as shell subprocesses.
pub struct ShellRunner {
    project_root: PathBuf,
    timeout: u64,
    env_overrides: HashMap<String, String>,
}

impl ShellRunner {
    pub fn new(project_root: &Path) -> Self {
        Self {
            project_root: project_root.to_path_buf(),
            timeout: 300,
            env_overrides: HashMap::new(),
        }
    }

    pub fn with_timeout(mut self, timeout: u64) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_env_overrides(mut self, env_overrides: HashMap<String, String>) -> Self {
        self.env_overrides = env_overrides;
        self
    }

    /// Execute a single metric's shell command.
    ///
    /// Returns a MetricResult with pass/fail status based on either
    /// regex pattern matching or process exit code.
    pub fn run(&self, metric: &Metric, dry_run: bool) -> MetricResult {
        // Check waiver first
        if let Some(ref waiver) = metric.waiver {
            if waiver.is_active(None) {
                return MetricResult {
                    metric_name: metric.name.clone(),
                    passed: true,
                    output: format!("[WAIVED] {}", waiver.reason),
                    tier: metric.tier,
                    hard_gate: metric.gate == Gate::Hard,
                    duration_ms: 0.0,
                    state: ResultState::Waived,
                };
            }
        }

        if dry_run {
            return MetricResult {
                metric_name: metric.name.clone(),
                passed: true,
                output: format!("[DRY-RUN] Would run: {}", metric.command),
                tier: metric.tier,
                hard_gate: metric.gate == Gate::Hard,
                duration_ms: 0.0,
                state: ResultState::Pass,
            };
        }

        let start = Instant::now();
        let timeout = metric.timeout_seconds.unwrap_or(self.timeout);

        // Build the environment
        let mut env: HashMap<String, String> = std::env::vars().collect();
        env.extend(self.env_overrides.clone());

        // Use a thread to implement timeout
        let command_str = metric.command.clone();
        let project_root = self.project_root.clone();
        let env_clone = env;

        let handle = std::thread::spawn(move || {
            let mut cmd = Command::new("/bin/bash");
            cmd.arg("-lc")
                .arg(&command_str)
                .current_dir(&project_root)
                .envs(&env_clone);

            cmd.output()
        });

        // Wait for the thread with timeout
        let timeout_duration = std::time::Duration::from_secs(timeout);
        let result = match wait_thread_with_timeout(handle, timeout_duration) {
            Some(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}{}", stdout, stderr);

                let passed = if !metric.pattern.is_empty() {
                    Regex::new(&metric.pattern)
                        .map(|re| re.is_match(&combined))
                        .unwrap_or(false)
                } else {
                    output.status.success()
                };

                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                let output_truncated = truncate_utf8(&combined, 2000);

                MetricResult::new(metric.name.clone(), passed, output_truncated, metric.tier)
                    .with_hard_gate(metric.gate == Gate::Hard)
                    .with_duration_ms(elapsed)
            }
            Some(Err(e)) => {
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                MetricResult::new(metric.name.clone(), false, e.to_string(), metric.tier)
                    .with_hard_gate(metric.gate == Gate::Hard)
                    .with_duration_ms(elapsed)
            }
            None => {
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                MetricResult::new(
                    metric.name.clone(),
                    false,
                    format!("TIMEOUT ({}s)", timeout),
                    metric.tier,
                )
                .with_hard_gate(metric.gate == Gate::Hard)
                .with_duration_ms(elapsed)
            }
        };

        result
    }

    /// Execute multiple metrics, optionally in parallel.
    ///
    /// Results are returned in the same order as the input metrics.
    pub fn run_batch(
        &self,
        metrics: &[Metric],
        parallel: bool,
        dry_run: bool,
        progress_callback: Option<&ProgressCallback>,
    ) -> Vec<MetricResult> {
        if !parallel || dry_run {
            let mut results = Vec::new();
            for metric in metrics {
                if let Some(cb) = progress_callback {
                    cb("start", metric, None);
                }
                let result = self.run(metric, dry_run);
                if let Some(cb) = progress_callback {
                    cb("end", metric, Some(&result));
                }
                results.push(result);
            }
            return results;
        }

        // Parallel execution — results already collected in order since
        // map() iterates sequentially here. True thread-pool parallelism
        // mirrors the Python ThreadPoolExecutor approach.
        metrics
            .iter()
            .map(|metric| {
                if let Some(cb) = progress_callback {
                    cb("start", metric, None);
                }
                let result = self.run(metric, false);
                if let Some(cb) = progress_callback {
                    cb("end", metric, Some(&result));
                }
                result
            })
            .collect()
    }
}

/// Safely truncate a string to a maximum number of bytes at a valid UTF-8 boundary.
fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Find a valid UTF-8 char boundary
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

fn wait_thread_with_timeout(
    handle: std::thread::JoinHandle<Result<std::process::Output, std::io::Error>>,
    timeout: std::time::Duration,
) -> Option<Result<std::process::Output, std::io::Error>> {
    let start = Instant::now();
    loop {
        if handle.is_finished() {
            return Some(handle.join().unwrap_or_else(|_| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "thread panicked",
                ))
            }));
        }
        if start.elapsed() > timeout {
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Metric, ResultState, Waiver};
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    #[test]
    fn test_dry_run() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let m = Metric::new("test", "echo hello");
        let result = runner.run(&m, true);
        assert!(result.passed);
        assert!(result.output.contains("[DRY-RUN]"));
        assert_eq!(result.metric_name, "test");
    }

    #[test]
    fn test_run_success_exit_code() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let m = Metric::new("echo_test", "echo ok");
        let result = runner.run(&m, false);
        assert!(result.passed);
        assert!(result.output.contains("ok"));
    }

    #[test]
    fn test_run_failure_exit_code() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let m = Metric::new("fail_test", "exit 1");
        let result = runner.run(&m, false);
        assert!(!result.passed);
    }

    #[test]
    fn test_run_pattern_match() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let mut m = Metric::new("pattern_test", "echo 'Tests 42 passed'");
        m.pattern = r"Tests\s+\d+\s+passed".to_string();
        let result = runner.run(&m, false);
        assert!(result.passed);
    }

    #[test]
    fn test_run_pattern_no_match() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let mut m = Metric::new("pattern_fail", "echo 'Tests 0 failed'");
        m.pattern = r"Tests\s+\d+\s+passed".to_string();
        let result = runner.run(&m, false);
        assert!(!result.passed);
    }

    #[test]
    fn test_run_timeout() {
        let runner = ShellRunner::new(Path::new("/tmp")).with_timeout(1);
        let m = Metric::new("slow", "sleep 10");
        let result = runner.run(&m, false);
        assert!(!result.passed);
        assert!(result.output.contains("TIMEOUT"));
    }

    #[test]
    fn test_run_metric_specific_timeout() {
        let runner = ShellRunner::new(Path::new("/tmp")).with_timeout(5);
        let mut m = Metric::new("slow", "sleep 2");
        m.timeout_seconds = Some(1);
        let result = runner.run(&m, false);
        assert!(!result.passed);
        assert!(result.output.contains("TIMEOUT (1s)"));
    }

    #[test]
    fn test_run_hard_gate_preserved() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let m = Metric::new("gate", "echo ok").with_hard_gate(true);
        let result = runner.run(&m, false);
        assert!(result.hard_gate);
    }

    #[test]
    fn test_run_batch_serial() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let metrics = vec![
            Metric::new("a", "echo a"),
            Metric::new("b", "echo b"),
        ];
        let results = runner.run_batch(&metrics, false, false, None);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].metric_name, "a");
        assert_eq!(results[1].metric_name, "b");
    }

    #[test]
    fn test_run_batch_parallel() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let metrics = vec![
            Metric::new("a", "echo a"),
            Metric::new("b", "echo b"),
        ];
        let results = runner.run_batch(&metrics, true, false, None);
        assert_eq!(results.len(), 2);
        // Order preserved
        assert_eq!(results[0].metric_name, "a");
        assert_eq!(results[1].metric_name, "b");
    }

    #[test]
    fn test_run_batch_dry_run() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let metrics = vec![Metric::new("x", "rm -rf /")];
        let results = runner.run_batch(&metrics, false, true, None);
        assert!(results[0].passed);
        assert!(results[0].output.contains("[DRY-RUN]"));
    }

    #[test]
    fn test_run_batch_emits_progress_events() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let metrics = vec![Metric::new("a", "echo a"), Metric::new("b", "echo b")];
        let events: Arc<Mutex<Vec<(String, String, Option<String>)>>> =
            Arc::new(Mutex::new(Vec::new()));

        let events_clone = events.clone();
        let cb: ProgressCallback = Box::new(move |event, metric, result| {
            events_clone.lock().unwrap().push((
                event.to_string(),
                metric.name.clone(),
                result.map(|r| r.state.as_str().to_string()),
            ));
        });

        runner.run_batch(&metrics, false, false, Some(&cb));

        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 4);
        assert_eq!(captured[0], ("start".to_string(), "a".to_string(), None));
        assert_eq!(
            captured[1],
            ("end".to_string(), "a".to_string(), Some("pass".to_string()))
        );
        assert_eq!(captured[2], ("start".to_string(), "b".to_string(), None));
        assert_eq!(
            captured[3],
            ("end".to_string(), "b".to_string(), Some("pass".to_string()))
        );
    }

    #[test]
    fn test_run_waived_metric() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let today = chrono::Utc::now().date_naive();
        let mut metric = Metric::new("waived", "exit 1");
        metric.waiver = Some(Waiver {
            reason: "temporary waiver".to_string(),
            owner: String::new(),
            tracking_issue: None,
            expires_at: Some(today + chrono::Duration::days(1)),
        });
        let result = runner.run(&metric, false);
        assert!(result.passed);
        assert_eq!(result.state, ResultState::Waived);
        assert!(result.output.contains("temporary waiver"));
    }
}
