//! `routa chat` — Interactive chat session with an agent.
//!
//! Creates an ACP session and provides a REPL-style interface for
//! sending prompts and receiving responses, mirroring the Next.js
//! ChatPanel experience from the homepage.
//!
//! Typing `@` at the start of your message opens an interactive specialist
//! picker so you can switch context without leaving the chat.

use std::io::{self, BufRead, Write};
use std::sync::Arc;

use console::style;
use dialoguer::{theme::ColorfulTheme, Select};
use routa_core::models::agent::AgentRole;
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use tokio::sync::broadcast;

use super::tui::TuiRenderer;

pub async fn run(
    state: &AppState,
    workspace_id: &str,
    provider: &str,
    role: &str,
) -> Result<(), String> {
    let _agent_role = AgentRole::from_str(role).ok_or_else(|| {
        format!(
            "Invalid role: {}. Use ROUTA, CRAFTER, GATE, or DEVELOPER",
            role
        )
    })?;

    let router = RpcRouter::new(state.clone());

    // Create agent for this chat session via RPC
    let agent_name = format!("cli-{}", role.to_lowercase());
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": role,
                "workspaceId": workspace_id
            }
        }))
        .await;

    let agent_id = create_response
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
        .ok_or("Failed to get agent ID from creation result")?
        .to_string();

    // Create ACP session
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI Chat                                         ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("║  Agent : {:<48} ║", format!("{} ({})", &agent_id[..8], role));
    println!("║  Workspace : {:<44} ║", workspace_id);
    println!("║  Provider  : {:<44} ║", provider);
    println!("╚══════════════════════════════════════════════════════════╝");

    let mut session_rx: Option<broadcast::Receiver<serde_json::Value>> = None;

    let spawn_result = state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.to_string(),
            Some(provider.to_string()),
            Some(role.to_string()),
            None,
            None,
        )
        .await;

    match spawn_result {
        Ok((sid, _)) => {
            println!("  {} Session: {}", style("●").green(), sid);
            // Register with orchestrator
            let acp = Arc::new(state.acp_manager.clone());
            let orchestrator = RoutaOrchestrator::new(
                OrchestratorConfig::default(),
                acp,
                state.agent_store.clone(),
                state.task_store.clone(),
                state.event_bus.clone(),
            );
            orchestrator
                .register_agent_session(&agent_id, &session_id)
                .await;

            session_rx = state.acp_manager.subscribe(&session_id).await;
        }
        Err(e) => {
            println!(
                "  {} Could not create ACP session: {}. Running in offline mode.",
                style("!").yellow(),
                e
            );
        }
    }

    println!();
    println!(
        "{}",
        style("Type your message and press Enter. /quit to exit.").dim()
    );
    println!(
        "{}",
        style("  Start with @ to pick a specialist  •  /agents  /tasks  /status").dim()
    );
    println!();

    // Pre-load specialists for @ menu
    let specialists = SpecialistConfig::list_available();

    // We need to read stdin line-by-line. Because ACP responses arrive async
    // we drain the broadcast channel after each prompt send.
    let stdin = io::stdin();
    let reader = stdin.lock();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read input: {}", e))?;
        let trimmed = line.trim();

        if trimmed.is_empty() {
            print!("> ");
            io::stdout().flush().ok();
            continue;
        }

        // ── Slash commands ───────────────────────────────────────────────
        match trimmed {
            "/quit" | "/exit" | "/q" => {
                println!("{}", style("Goodbye!").dim());
                state.acp_manager.kill_session(&session_id).await;
                break;
            }
            "/agents" => {
                let response = router
                    .handle_value(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "agents.list",
                        "params": { "workspaceId": workspace_id }
                    }))
                    .await;
                if let Some(result) = response.get("result") {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(result).unwrap_or_default()
                    );
                }
                print!("\n> ");
                io::stdout().flush().ok();
                continue;
            }
            "/tasks" => {
                let response = router
                    .handle_value(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tasks.list",
                        "params": { "workspaceId": workspace_id }
                    }))
                    .await;
                if let Some(result) = response.get("result") {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(result).unwrap_or_default()
                    );
                }
                print!("\n> ");
                io::stdout().flush().ok();
                continue;
            }
            "/status" => {
                let response = router
                    .handle_value(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "agents.get",
                        "params": { "id": &agent_id }
                    }))
                    .await;
                if let Some(result) = response.get("result") {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(result).unwrap_or_default()
                    );
                }
                print!("\n> ");
                io::stdout().flush().ok();
                continue;
            }
            _ => {}
        }

        // ── @ mention — interactive specialist selector ──────────────────
        let final_prompt = if trimmed.starts_with('@') {
            let (specialist_id, remainder) = parse_at_mention(trimmed);

            let selected = if let Some(id) = specialist_id {
                // Exact match from inline @id
                specialists
                    .iter()
                    .find(|s| s.id == id)
                    .cloned()
                    .or_else(|| {
                        // Show picker pre-filtered to the typed prefix
                        pick_specialist_interactive(&specialists, Some(&id))
                    })
            } else {
                // Bare `@` — open picker
                pick_specialist_interactive(&specialists, None)
            };

            match selected {
                Some(specialist) => {
                    // Inline remainder or ask for prompt
                    let user_req = if let Some(rem) = remainder.filter(|r| !r.is_empty()) {
                        rem
                    } else {
                        // Use dialoguer Input for the user request
                        dialoguer::Input::with_theme(&ColorfulTheme::default())
                            .with_prompt(format!("Prompt for {}", specialist.name))
                            .interact_text()
                            .unwrap_or_default()
                    };
                    build_specialist_prompt(&specialist, &agent_id, workspace_id, &user_req)
                }
                None => {
                    // User cancelled picker — skip this line
                    print!("\n> ");
                    io::stdout().flush().ok();
                    continue;
                }
            }
        } else {
            trimmed.to_string()
        };

        if final_prompt.trim().is_empty() {
            print!("\n> ");
            io::stdout().flush().ok();
            continue;
        }

        // ── Send prompt ──────────────────────────────────────────────────
        match state.acp_manager.prompt(&session_id, &final_prompt).await {
            Ok(_) => {
                // Stream updates until idle / turn_complete
                if let Some(ref mut rx) = session_rx {
                    stream_until_idle(rx, state, &session_id).await;
                }
            }
            Err(e) => {
                println!("{} Failed to send prompt: {}", style("✘").red(), e);
            }
        }

        print!("\n> ");
        io::stdout().flush().ok();
    }

    Ok(())
}

/// Drain the broadcast channel until idle (no message for 2 s) or turn_complete.
async fn stream_until_idle(
    rx: &mut broadcast::Receiver<serde_json::Value>,
    state: &AppState,
    session_id: &str,
) {
    let mut renderer = TuiRenderer::new();
    let mut idle_ticks = 0u32;

    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv()).await {
            Ok(Ok(update)) => {
                idle_ticks = 0;
                // Detect turn_complete to stop streaming
                let is_done = update
                    .get("params")
                    .and_then(|p| p.get("update"))
                    .and_then(|u| u.get("sessionUpdate"))
                    .and_then(|v| v.as_str())
                    == Some("turn_complete");
                renderer.handle_update(&update);
                if is_done {
                    break;
                }
            }
            Ok(Err(_)) => break,
            Err(_) => {
                idle_ticks += 1;
                if idle_ticks >= 5 || !state.acp_manager.is_alive(session_id).await {
                    break;
                }
            }
        }
    }
    renderer.finish();
}

/// Parse `@specialist-id rest of prompt` from a single trimmed line.
///
/// Returns `(Option<id>, Option<remainder>)`.
fn parse_at_mention(input: &str) -> (Option<String>, Option<String>) {
    let without = match input.strip_prefix('@') {
        Some(s) => s,
        None => return (None, None),
    };

    let mut parts = without.splitn(2, char::is_whitespace);
    let id = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase());
    let remainder = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    (id, remainder)
}

/// Show a dialoguer Select menu filtered to specialists whose id starts with `prefix`.
fn pick_specialist_interactive(
    specialists: &[SpecialistConfig],
    prefix: Option<&str>,
) -> Option<SpecialistConfig> {
    let filtered: Vec<&SpecialistConfig> = if let Some(p) = prefix {
        let lower = p.to_lowercase();
        let exact: Vec<_> = specialists
            .iter()
            .filter(|s| s.id == lower)
            .collect();
        if !exact.is_empty() {
            return exact.into_iter().next().cloned();
        }
        specialists
            .iter()
            .filter(|s| s.id.starts_with(&lower))
            .collect()
    } else {
        specialists.iter().collect()
    };

    if filtered.is_empty() {
        println!("{}", style("No matching specialists found.").yellow());
        return None;
    }

    let items: Vec<String> = filtered
        .iter()
        .map(|s| {
            format!(
                "{} ({}){}",
                s.id,
                s.role.as_str(),
                s.description
                    .as_ref()
                    .map(|d| format!(" — {}", d))
                    .unwrap_or_default()
            )
        })
        .collect();

    let theme = ColorfulTheme::default();
    match Select::with_theme(&theme)
        .with_prompt("Select specialist (@)")
        .items(&items)
        .default(0)
        .interact_opt()
    {
        Ok(Some(idx)) => Some(filtered[idx].clone()),
        _ => None,
    }
}

/// Build the specialist system prompt + user request for injection.
fn build_specialist_prompt(
    specialist: &SpecialistConfig,
    agent_id: &str,
    workspace_id: &str,
    user_req: &str,
) -> String {
    format!(
        "{}\n\n---\n\n**Your Agent ID:** {}\n**Workspace ID:** {}\n\n## User Request\n\n{}\n\n---\n**Reminder:** {}\n",
        specialist.system_prompt, agent_id, workspace_id, user_req, specialist.role_reminder
    )
}
