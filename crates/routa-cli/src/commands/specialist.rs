//! `routa specialist` — direct specialist file execution helpers.

use routa_core::state::AppState;

use super::agent;

pub async fn run(
    state: &AppState,
    file: &str,
    prompt: Option<&str>,
    workspace_id: &str,
    provider: Option<&str>,
) -> Result<(), String> {
    agent::run(state, None, Some(file), prompt, workspace_id, provider, None).await
}
