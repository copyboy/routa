//! `TuiRenderer` — streaming terminal UI renderer for ACP session updates.
//!
//! Mirrors the ChatPanel streaming behaviour from the web UI:
//! - Agent message chunks are printed inline without newlines (streaming)
//! - Tool calls show a pending indicator that is overwritten on completion
//! - Thoughts are printed in dimmed style
//! - Process output is printed in gray to stderr
//! - A status bar at the bottom shows the current activity

use std::io::Write;
use std::time::Instant;

use console::{style, Term};

/// Stateful streaming renderer for a single ACP session.
pub struct TuiRenderer {
    term: Term,
    /// Whether the last printed character ended with a newline.
    at_line_start: bool,
    /// The tool call currently being rendered (name, start time).
    active_tool: Option<(String, Instant)>,
}

impl Default for TuiRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiRenderer {
    pub fn new() -> Self {
        Self {
            term: Term::stdout(),
            at_line_start: true,
            active_tool: None,
        }
    }

    /// Handle one `session/update` notification value.
    pub fn handle_update(&mut self, update: &serde_json::Value) {
        let params = match update.get("params") {
            Some(p) => p,
            None => return,
        };
        let inner = match params.get("update") {
            Some(u) => u,
            None => return,
        };
        let kind = inner
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match kind {
            "agent_message_chunk" => {
                let text = extract_text(inner);
                if !text.is_empty() {
                    self.ensure_agent_prefix();
                    print!("{}", text);
                    std::io::stdout().flush().ok();
                    self.at_line_start = text.ends_with('\n');
                }
            }
            "agent_message" => {
                let text = extract_text(inner);
                if !text.is_empty() {
                    self.finish_active_tool();
                    self.ensure_newline();
                    println!("{} {}", style("▶").cyan().bold(), text);
                    self.at_line_start = true;
                }
            }
            "agent_thought_chunk" => {
                let text = extract_text(inner);
                if !text.is_empty() {
                    print!("{}", style(text).dim());
                    std::io::stdout().flush().ok();
                    self.at_line_start = false;
                }
            }
            "tool_call" | "tool_call_start" => {
                let name = tool_name(inner);
                let status = inner
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("running");
                self.finish_active_tool();
                self.ensure_newline();

                match status {
                    "completed" => {
                        println!(
                            "  {} {}",
                            style("✔").green(),
                            style(&name).dim()
                        );
                    }
                    "failed" => {
                        println!(
                            "  {} {}",
                            style("✘").red(),
                            style(&name).dim()
                        );
                    }
                    _ => {
                        print!(
                            "  {} {} …",
                            style("⠿").yellow(),
                            style(&name).dim()
                        );
                        std::io::stdout().flush().ok();
                        self.active_tool = Some((name, Instant::now()));
                        self.at_line_start = false;
                    }
                }
            }
            "tool_call_update" => {
                let name = tool_name(inner);
                let status = inner
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("running");

                match status {
                    "completed" | "failed" => {
                        if self.active_tool.is_some() {
                            // Clear the pending "…" line
                            self.term.clear_line().ok();
                            let elapsed = self
                                .active_tool
                                .as_ref()
                                .map(|(_, t)| t.elapsed().as_millis())
                                .unwrap_or(0);
                            let icon = if status == "completed" {
                                style("✔").green()
                            } else {
                                style("✘").red()
                            };
                            println!(
                                "\r  {} {} {}",
                                icon,
                                style(&name).dim(),
                                style(format!("({} ms)", elapsed)).dim()
                            );
                            self.active_tool = None;
                            self.at_line_start = true;
                        } else {
                            let icon = if status == "completed" {
                                style("✔").green()
                            } else {
                                style("✘").red()
                            };
                            println!("  {} {}", icon, style(&name).dim());
                            self.at_line_start = true;
                        }
                    }
                    _ => {}
                }
            }
            "process_output" => {
                let data = inner.get("data").and_then(|v| v.as_str()).unwrap_or("");
                if !data.is_empty() {
                    eprint!("{}", style(data).color256(240));
                }
            }
            "turn_complete" => {
                self.finish_active_tool();
                self.ensure_newline();
                println!("{}", style("── turn complete ──").dim());
                self.at_line_start = true;
            }
            "usage_update" => {
                if let (Some(input), Some(output)) = (
                    inner.get("inputTokens").and_then(|v| v.as_u64()),
                    inner.get("outputTokens").and_then(|v| v.as_u64()),
                ) {
                    self.ensure_newline();
                    println!(
                        "{}",
                        style(format!("  tokens: {} in / {} out", input, output)).dim()
                    );
                    self.at_line_start = true;
                }
            }
            _ => {
                tracing::debug!("TuiRenderer: unhandled update kind: {}", kind);
            }
        }
    }

    /// Ensure we are at the start of a new line before printing a block element.
    fn ensure_newline(&mut self) {
        if !self.at_line_start {
            println!();
            self.at_line_start = true;
        }
    }

    /// Clear any active pending tool spinner line.
    fn finish_active_tool(&mut self) {
        if self.active_tool.take().is_some() {
            self.term.clear_line().ok();
            self.at_line_start = true;
        }
    }

    /// Print the "▶ " agent prefix once at the start of a new agent message stream.
    fn ensure_agent_prefix(&mut self) {
        if self.at_line_start {
            print!("{} ", style("▶").cyan().bold());
            self.at_line_start = false;
        }
    }

    /// Call at end of session to flush any dangling lines.
    pub fn finish(&mut self) {
        self.finish_active_tool();
        self.ensure_newline();
    }
}

fn extract_text(inner: &serde_json::Value) -> &str {
    inner
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .or_else(|| inner.get("text").and_then(|t| t.as_str()))
        .unwrap_or("")
}

fn tool_name(inner: &serde_json::Value) -> String {
    inner
        .get("kind")
        .or_else(|| inner.get("title"))
        .or_else(|| inner.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string()
}
