//! `routa specialist` — direct specialist file execution helpers.

use std::path::Path;

use routa_core::state::AppState;

use super::agent;

pub async fn run(
    state: &AppState,
    specialist_target: &str,
    prompt: Option<&str>,
    workspace_id: &str,
    provider: Option<&str>,
    provider_timeout_ms: Option<u64>,
    provider_retries: u8,
) -> Result<(), String> {
    if looks_like_existing_specialist_file(specialist_target) {
        return agent::run(
            state,
            None,
            Some(specialist_target),
            prompt,
            workspace_id,
            provider,
            None,
            provider_timeout_ms,
            provider_retries,
        )
        .await;
    }

    agent::run(
        state,
        Some(specialist_target),
        None,
        prompt,
        workspace_id,
        provider,
        None,
        provider_timeout_ms,
        provider_retries,
    )
    .await
}

fn looks_like_existing_specialist_file(target: &str) -> bool {
    let path = Path::new(target);
    path.is_file()
        && path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| matches!(ext, "yaml" | "yml"))
}

#[cfg(test)]
mod tests {
    use super::looks_like_existing_specialist_file;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn detects_existing_specialist_file_targets() {
        let temp_dir = tempfile::tempdir().unwrap();
        let path = PathBuf::from(temp_dir.path()).join("ui-journey-evaluator.yaml");
        fs::write(&path, "id: ui-journey-evaluator\n").unwrap();
        assert!(looks_like_existing_specialist_file(&path.to_string_lossy()));

        let yml_path = PathBuf::from(temp_dir.path()).join("qa-checklist.yml");
        fs::write(&yml_path, "id: qa-checklist\n").unwrap();
        assert!(looks_like_existing_specialist_file(
            &yml_path.to_string_lossy()
        ));
    }

    #[test]
    fn treats_non_path_input_as_specialist_id() {
        assert!(!looks_like_existing_specialist_file("ui-journey-evaluator"));
    }
}
