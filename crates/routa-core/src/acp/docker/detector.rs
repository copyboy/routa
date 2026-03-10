//! Docker availability detection with caching.
//!
//! Mirrors the TypeScript `DockerDetector` in `src/core/acp/docker/detector.ts`.

use super::types::{DockerPullResult, DockerStatus};
use chrono::Utc;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::RwLock;

/// Cache TTL in milliseconds (30 seconds).
const CACHE_TTL_MS: u64 = 30_000;

/// Default timeout for Docker commands in milliseconds.
const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Docker availability detector with caching.
pub struct DockerDetector {
    cached_status: Arc<RwLock<Option<DockerStatus>>>,
    cached_at: Arc<RwLock<Instant>>,
}

impl Default for DockerDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl DockerDetector {
    /// Create a new DockerDetector instance.
    pub fn new() -> Self {
        Self {
            cached_status: Arc::new(RwLock::new(None)),
            cached_at: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(3600))),
        }
    }

    /// Check Docker availability, using cache if valid.
    pub async fn check_availability(&self, force_refresh: bool) -> DockerStatus {
        let now = Instant::now();
        let checked_at = Utc::now().to_rfc3339();

        // Check cache
        if !force_refresh {
            let cached = self.cached_status.read().await;
            let cached_time = *self.cached_at.read().await;

            if let Some(status) = cached.as_ref() {
                if now.duration_since(cached_time).as_millis() < CACHE_TTL_MS as u128 {
                    return status.clone();
                }
            }
        }

        // Run docker info command
        let status = self.run_docker_info(&checked_at).await;

        // Update cache
        *self.cached_status.write().await = Some(status.clone());
        *self.cached_at.write().await = now;

        status
    }

    /// Run `docker info` and parse the result.
    async fn run_docker_info(&self, checked_at: &str) -> DockerStatus {
        let result = tokio::time::timeout(
            Duration::from_millis(DEFAULT_TIMEOUT_MS),
            Command::new("docker")
                .args(["info", "--format", "{{json .}}"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let (version, api_version) = self.parse_docker_info(&stdout);

                DockerStatus {
                    available: true,
                    daemon_running: true,
                    version,
                    api_version,
                    error: None,
                    checked_at: checked_at.to_string(),
                }
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                DockerStatus {
                    available: false,
                    daemon_running: false,
                    error: Some(stderr.to_string()),
                    checked_at: checked_at.to_string(),
                    ..Default::default()
                }
            }
            Ok(Err(e)) => DockerStatus {
                available: false,
                daemon_running: false,
                error: Some(format!("Failed to run docker: {}", e)),
                checked_at: checked_at.to_string(),
                ..Default::default()
            },
            Err(_) => DockerStatus {
                available: false,
                daemon_running: false,
                error: Some("Docker command timed out".to_string()),
                checked_at: checked_at.to_string(),
                ..Default::default()
            },
        }
    }

    /// Parse Docker info JSON output.
    fn parse_docker_info(&self, stdout: &str) -> (Option<String>, Option<String>) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
            let version = json
                .get("ServerVersion")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let api_version = json
                .get("ClientInfo")
                .and_then(|c| c.get("ApiVersion"))
                .and_then(|v| v.as_str())
                .or_else(|| json.get("APIVersion").and_then(|v| v.as_str()))
                .map(|s| s.to_string());

            (version, api_version)
        } else {
            (None, None)
        }
    }

    /// Check if a Docker image is available locally.
    pub async fn is_image_available(&self, image: &str) -> bool {
        let result = tokio::time::timeout(
            Duration::from_millis(DEFAULT_TIMEOUT_MS),
            Command::new("docker")
                .args(["images", "-q", image])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                !String::from_utf8_lossy(&output.stdout).trim().is_empty()
            }
            _ => false,
        }
    }

    /// Pull a Docker image from the registry.
    pub async fn pull_image(&self, image: &str) -> DockerPullResult {
        // 10 minute timeout for image pull
        let result = tokio::time::timeout(
            Duration::from_secs(10 * 60),
            Command::new("docker")
                .args(["pull", image])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!(
                    "{}{}",
                    stdout,
                    if stderr.is_empty() {
                        "".to_string()
                    } else {
                        format!("\n{}", stderr)
                    }
                );

                DockerPullResult {
                    ok: true,
                    image: image.to_string(),
                    output: Some(combined.trim().to_string()),
                    error: None,
                }
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                DockerPullResult {
                    ok: false,
                    image: image.to_string(),
                    output: None,
                    error: Some(stderr.to_string()),
                }
            }
            Ok(Err(e)) => DockerPullResult {
                ok: false,
                image: image.to_string(),
                output: None,
                error: Some(format!("Failed to run docker pull: {}", e)),
            },
            Err(_) => DockerPullResult {
                ok: false,
                image: image.to_string(),
                output: None,
                error: Some("Docker pull timed out".to_string()),
            },
        }
    }
}
