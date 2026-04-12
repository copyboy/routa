use super::*;
use chrono::Utc;
use std::collections::BTreeSet;

impl RuntimeState {
    pub(super) fn apply_hook_event(&mut self, event: HookEvent) {
        if !event.file_paths.is_empty() {
            self.last_file_hook_at_ms = Some(event.observed_at_ms);
        }
        {
            let session = self
                .sessions
                .entry(event.session_id.clone())
                .or_insert_with(|| SessionView {
                    session_id: event.session_id.clone(),
                    display_name: event.session_display_name.clone(),
                    cwd: event.cwd.clone(),
                    model: event.model.clone(),
                    client: event.client.clone(),
                    transcript_path: event.transcript_path.clone(),
                    source: event.session_source.clone(),
                    started_at_ms: event.observed_at_ms,
                    last_seen_at_ms: event.observed_at_ms,
                    status: "active".to_string(),
                    tmux_pane: event.tmux_pane.clone(),
                    touched_files: BTreeSet::new(),
                    last_turn_id: event.turn_id.clone(),
                    last_event_name: Some(event.event_name.clone()),
                    last_tool_name: event.tool_name.clone(),
                });

            session.cwd = event.cwd.clone();
            if event.session_display_name.is_some() {
                session.display_name = event.session_display_name.clone();
            }
            session.model = event.model.clone().or_else(|| session.model.clone());
            session.client = event.client.clone();
            if event.transcript_path.is_some() {
                session.transcript_path = event.transcript_path.clone();
            }
            if event.session_source.is_some() {
                session.source = event.session_source.clone();
            }
            session.last_seen_at_ms = event.observed_at_ms;
            session.last_turn_id = event.turn_id.clone();
            session.last_event_name = Some(event.event_name.clone());
            session.last_tool_name = event.tool_name.clone();
            session.tmux_pane = event
                .tmux_pane
                .clone()
                .or_else(|| session.tmux_pane.clone());
            session.status = if is_stop_event(&event.event_name) {
                "stopped".to_string()
            } else {
                "active".to_string()
            };
        }

        self.push_event(
            event.observed_at_ms,
            EventSource::Hook,
            format!(
                "{} {} {}",
                short_session(&event.session_id),
                event.event_name,
                event.tool_name.unwrap_or_else(|| "-".to_string())
            ),
        );

        for rel_path in event.file_paths {
            if let Some(session) = self.sessions.get_mut(&event.session_id) {
                session.touched_files.insert(rel_path.clone());
            }
            let file = self
                .files
                .entry(rel_path.clone())
                .or_insert_with(|| FileView {
                    rel_path: rel_path.clone(),
                    dirty: true,
                    state_code: "modify".to_string(),
                    entry_kind: EntryKind::File,
                    last_modified_at_ms: event.observed_at_ms,
                    last_session_id: Some(event.session_id.clone()),
                    confidence: AttributionConfidence::Exact,
                    conflicted: false,
                    touched_by: BTreeSet::new(),
                    recent_events: Vec::new(),
                });
            if let Some(existing_session) = &file.last_session_id {
                if existing_session != &event.session_id {
                    file.conflicted = true;
                }
            }
            file.dirty = true;
            file.last_modified_at_ms = event.observed_at_ms;
            file.last_session_id = Some(event.session_id.clone());
            file.confidence = AttributionConfidence::Exact;
            file.touched_by.insert(event.session_id.clone());
            file.recent_events.insert(
                0,
                format!("{} {}", event.event_name, short_session(&event.session_id)),
            );
            file.recent_events.truncate(8);
        }
    }

    pub(super) fn apply_git_event(&mut self, event: GitEvent) {
        self.push_event(
            event.observed_at_ms,
            EventSource::Git,
            format!(
                "git {} {}",
                event.event_name,
                event.branch.unwrap_or_else(|| "-".to_string())
            ),
        );
        if matches!(
            event.event_name.as_str(),
            "post-commit"
                | "post-checkout"
                | "post-merge"
                | "git-reset"
                | "git-restore"
                | "git-checkout"
        ) {
            for file in self.files.values_mut() {
                file.dirty = false;
                file.state_code = "clean".to_string();
            }
        }
    }

    pub(super) fn apply_attribution_event(&mut self, event: AttributionEvent) {
        let file = self
            .files
            .entry(event.rel_path.clone())
            .or_insert_with(|| FileView {
                rel_path: event.rel_path.clone(),
                dirty: true,
                state_code: "modify".to_string(),
                entry_kind: EntryKind::File,
                last_modified_at_ms: event.observed_at_ms,
                last_session_id: Some(event.session_id.clone()),
                confidence: AttributionConfidence::from_str(&event.confidence),
                conflicted: false,
                touched_by: BTreeSet::new(),
                recent_events: Vec::new(),
            });
        file.last_session_id = Some(event.session_id.clone());
        file.last_modified_at_ms = event.observed_at_ms;
        file.confidence = AttributionConfidence::from_str(&event.confidence);
        file.conflicted = false;
        file.touched_by.insert(event.session_id.clone());
        file.recent_events.insert(
            0,
            format!("{} {}", event.reason, short_session(&event.session_id)),
        );
        file.recent_events.truncate(8);

        if let Some(session) = self.sessions.get_mut(&event.session_id) {
            session.touched_files.insert(event.rel_path.clone());
            session.last_seen_at_ms = event.observed_at_ms;
        }

        self.push_attribution_event(
            event.observed_at_ms,
            format!(
                "assign {} {}",
                short_session(&event.session_id),
                event.rel_path
            ),
        );
    }

    pub(super) fn apply_fitness_event(&mut self, event: FitnessEvent) {
        let score = event
            .final_score
            .map(|value| format!("{value:.1}%"))
            .unwrap_or_else(|| "-".to_string());
        self.push_event(
            event.observed_at_ms,
            EventSource::Fitness,
            format!("fitness {} {} {}", event.mode, event.status, score),
        );
    }

    pub(super) fn push_watch_event(&mut self, observed_at_ms: i64, message: String) {
        self.push_event(observed_at_ms, EventSource::Watch, message);
    }

    pub(super) fn push_attribution_event(&mut self, observed_at_ms: i64, message: String) {
        self.push_event(observed_at_ms, EventSource::Attribution, message);
    }

    fn push_event(&mut self, observed_at_ms: i64, source: EventSource, message: String) {
        self.event_log.push_front(EventLogEntry {
            observed_at_ms,
            source,
            message,
        });
        while self.event_log.len() > EVENT_LOG_LIMIT {
            self.event_log.pop_back();
        }
    }

    pub(super) fn prune_stale_sessions(&mut self) {
        let cutoff = Utc::now().timestamp_millis() - DEFAULT_INFERENCE_WINDOW_MS;
        for session in self.sessions.values_mut() {
            if session.status != "stopped" {
                session.status = if session.last_seen_at_ms >= cutoff {
                    "active".to_string()
                } else {
                    "idle".to_string()
                };
            }
        }
    }

    pub(super) fn single_active_session_id(&self, now_ms: i64) -> Option<String> {
        let cutoff = now_ms - DEFAULT_INFERENCE_WINDOW_MS;
        let mut active = self
            .sessions
            .values()
            .filter(|session| session.status != "stopped" && session.last_seen_at_ms >= cutoff)
            .map(|session| session.session_id.clone());
        let first = active.next()?;
        if active.next().is_some() {
            None
        } else {
            Some(first)
        }
    }
}
