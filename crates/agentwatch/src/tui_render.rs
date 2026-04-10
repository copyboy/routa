use super::*;
use crate::state::{FileListMode, FocusPane};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use std::path::Path;

#[derive(Clone, Copy)]
pub(super) struct UiPalette {
    bg: Color,
    surface: Color,
    border: Color,
    text: Color,
    muted: Color,
    accent: Color,
    selection_focus: Color,
    selection_blur: Color,
}

struct FileFacts {
    line_count: usize,
    byte_size: u64,
    created_at: String,
    git_change_count: usize,
}

pub(super) fn palette(theme_mode: ThemeMode) -> UiPalette {
    match theme_mode {
        ThemeMode::Dark => UiPalette {
            bg: Color::Rgb(15, 23, 30),
            surface: Color::Rgb(24, 33, 43),
            border: Color::Rgb(67, 84, 100),
            text: Color::Rgb(210, 220, 229),
            muted: Color::Rgb(124, 141, 157),
            accent: Color::Rgb(154, 190, 214),
            selection_focus: Color::Rgb(56, 76, 96),
            selection_blur: Color::Rgb(40, 55, 70),
        },
        ThemeMode::Light => UiPalette {
            bg: Color::Rgb(238, 242, 246),
            surface: Color::Rgb(248, 250, 252),
            border: Color::Rgb(145, 161, 176),
            text: Color::Rgb(35, 50, 64),
            muted: Color::Rgb(101, 118, 135),
            accent: Color::Rgb(90, 126, 156),
            selection_focus: Color::Rgb(214, 225, 235),
            selection_blur: Color::Rgb(226, 234, 241),
        },
    }
}

pub(super) fn render(
    frame: &mut Frame,
    state: &RuntimeState,
    _feed: &RuntimeFeed,
    cache: &AppCache,
) {
    let colors = palette(state.theme_mode);
    frame.render_widget(
        Block::default().style(Style::default().bg(colors.bg).fg(colors.text)),
        frame.area(),
    );
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(8),
            Constraint::Length(5),
            Constraint::Length(1),
        ])
        .split(frame.area());

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(27),
            Constraint::Percentage(39),
            Constraint::Percentage(34),
        ])
        .split(outer[1]);

    render_title_bar(frame, outer[0], state);
    render_sessions(frame, columns[0], state);
    render_files(frame, columns[1], state, cache);
    render_detail(frame, columns[2], state, cache);
    render_log(frame, outer[2], state);
    render_footer(frame, outer[3], state);
}

fn render_sessions(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let items: Vec<ListItem> = state
        .session_items()
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let model = session.model.clone().unwrap_or_else(|| "-".to_string());
            let selected = idx == state.selected_session;
            let badge = status_badge(&session.status);
            let pane = session
                .tmux_pane
                .clone()
                .unwrap_or_else(|| if session.is_unknown_bucket { "?" } else { "-" }.to_string());
            let primary = Line::from(vec![
                Span::styled(
                    if session.is_unknown_bucket {
                        "Unknown".to_string()
                    } else {
                        shorten_path(&session.session_id, 12)
                    },
                    row_style(selected, state.focus == FocusPane::Sessions, colors)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                badge,
                Span::raw(" "),
                Span::styled(
                    if session.is_unknown_bucket {
                        "watch".to_string()
                    } else {
                        shorten_path(&model, 9)
                    },
                    Style::default().fg(colors.accent),
                ),
            ]);
            let secondary = Line::from(vec![
                Span::styled(format!("pane {pane}"), Style::default().fg(colors.muted)),
                Span::raw("  "),
                Span::styled(
                    format!("{} ago", time_ago(session.last_seen_at_ms)),
                    Style::default().fg(colors.muted),
                ),
                Span::raw("  "),
                Span::styled(
                    format!("{} files", session.touched_files_count),
                    Style::default().fg(colors.text),
                ),
            ]);
            let lines = vec![primary, secondary];
            let mut item = ListItem::new(lines);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Sessions, colors));
            }
            item
        })
        .collect();

    let list =
        List::new(items).block(panel_block("Sessions", state.focus == FocusPane::Sessions, colors));
    frame.render_widget(list, area);
}

fn render_files(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    cache: &AppCache,
) {
    let colors = palette(state.theme_mode);
    let outer_block = panel_block("Files", state.focus == FocusPane::Files, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(inner);
    let tabs = render_file_mode_tabs(state, split[0].width);
    frame.render_widget(
        Paragraph::new(tabs).style(Style::default().bg(colors.surface).fg(colors.text)),
        split[0],
    );
    let items: Vec<ListItem> = state
        .file_items()
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let selected = idx == state.selected_file;
            let diff_stat = cache.diff_stat(file).cloned().unwrap_or_else(|| DiffStatSummary {
                status: short_state_code(&file.state_code).to_string(),
                additions: None,
                deletions: None,
            });
            let primary = Line::from(vec![
                Span::styled(
                    shorten_path(&file.rel_path, 38),
                    row_style(selected, state.focus == FocusPane::Files, colors)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                if file.conflicted {
                    Span::styled(" !CONFLICT", Style::default().fg(STOPPED))
                } else {
                    Span::raw("")
                },
            ]);
            let secondary = render_file_secondary_line(file, &diff_stat, colors);
            let mut item = ListItem::new(vec![primary, secondary]);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Files, colors));
            }
            item
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::TOP)
            .border_style(Style::default().fg(colors.border))
            .style(Style::default().bg(colors.surface)),
    );
    frame.render_widget(list, split[1]);
}

fn render_detail(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(8), Constraint::Min(8)])
        .split(area);
    render_detail_summary(frame, sections[0], state);
    render_detail_body(frame, sections[1], state, cache);
}

fn render_detail_summary(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let mut lines = Vec::new();
    if let Some(file) = state.selected_file() {
        let facts = collect_file_facts(&state.repo_root, &file.rel_path);
        lines.push(Line::from(Span::styled(
            shorten_path(&file.rel_path, 32),
            Style::default().fg(colors.text).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(vec![
            Span::styled("last by ", Style::default().fg(colors.muted)),
            Span::styled(
                file.last_session_id
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                Style::default().fg(colors.accent),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("modified ", Style::default().fg(colors.muted)),
            Span::styled(
                time_label(file.last_modified_at_ms),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("confidence ", Style::default().fg(colors.muted)),
            Span::styled(
                file.confidence.as_str(),
                Style::default().fg(confidence_text_color(file.confidence.as_str())),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("lines ", Style::default().fg(colors.muted)),
            Span::styled(facts.line_count.to_string(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("size ", Style::default().fg(colors.muted)),
            Span::styled(format_bytes(facts.byte_size), Style::default().fg(colors.text)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("created ", Style::default().fg(colors.muted)),
            Span::styled(facts.created_at, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("git changes ", Style::default().fg(colors.muted)),
            Span::styled(
                facts.git_change_count.to_string(),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("owners ", Style::default().fg(colors.muted)),
            Span::styled(file.touched_by.len().to_string(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("state ", Style::default().fg(colors.muted)),
            Span::styled(
                if file.dirty { "dirty" } else { "clean" },
                Style::default().fg(if file.dirty { ACTIVE } else { IDLE }),
            ),
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(colors.muted),
        )));
        if let Some(session_id) = state.selected_session_id() {
            lines.push(Line::from(vec![
                Span::styled("session ", Style::default().fg(colors.muted)),
                Span::styled(session_id, Style::default().fg(colors.accent)),
            ]));
        }
    }

    let block = panel_block("Details", state.focus == FocusPane::Detail, colors);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_detail_body(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
    let colors = palette(state.theme_mode);
    let title = match state.detail_mode {
        DetailMode::Summary => "Diff Summary",
        DetailMode::File => "File Preview",
        DetailMode::Diff => "Diff Summary",
    };
    let file_text = match state.detail_mode {
        DetailMode::File => state
            .selected_file()
            .and_then(|file| cache.detail_text(file, DetailMode::File).map(str::to_string))
            .unwrap_or_else(|| "<loading file preview...>".to_string()),
        DetailMode::Summary | DetailMode::Diff => state
            .selected_file()
            .and_then(|file| cache.detail_text(file, DetailMode::Diff).map(str::to_string))
            .unwrap_or_else(|| "<loading diff...>".to_string()),
    };
    let file_path = state.selected_file().map(|file| file.rel_path.as_str());
    let content = match state.detail_mode {
        DetailMode::File => highlight_code_text(file_path, &file_text, state.theme_mode),
        DetailMode::Summary | DetailMode::Diff => {
            let diff_slice = if state.detail_mode == DetailMode::Summary {
                file_text.lines().take(18).collect::<Vec<_>>().join("\n")
            } else {
                file_text
            };
            highlight_diff_text(file_path, &diff_slice, state.theme_mode)
        }
    };
    frame.render_widget(
        Paragraph::new(content)
            .block(panel_block(title, false, colors))
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: false })
            .scroll((state.detail_scroll, 0)),
        area,
    );
}

fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let items: Vec<ListItem> = state
        .visible_event_log_items()
        .iter()
        .take(3)
        .map(|entry| {
            ListItem::new(Line::from(vec![
                Span::styled(format_ts(entry.observed_at_ms), Style::default().fg(colors.muted)),
                Span::raw(" "),
                Span::styled(
                    format!("[{}]", entry.source.label()),
                    Style::default().fg(source_color(entry.source)),
                ),
                Span::raw(" "),
                Span::styled(entry.message.clone(), Style::default().fg(colors.text)),
            ]))
        })
        .collect();

    let list = List::new(items).block(panel_block(
        format!("Event Stream ({})", state.event_log_filter.label()),
        false,
        colors,
    ));
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

fn render_file_mode_tabs(state: &RuntimeState, width: u16) -> Line<'static> {
    let colors = palette(state.theme_mode);
    let modes = [
        FileListMode::BySession,
        FileListMode::Global,
        FileListMode::UnknownConflict,
    ];
    let mut spans = Vec::new();
    let compact = width < 34;
    for (idx, mode) in modes.iter().enumerate() {
        if idx > 0 {
            spans.push(Span::raw("  "));
        }
        let label = match (mode, compact) {
            (FileListMode::BySession, false) => " BY SESSION ",
            (FileListMode::BySession, true) => " SESSION ",
            (FileListMode::Global, _) => " GLOBAL ",
            (FileListMode::UnknownConflict, false) => " UNKNOWN-CONFLICT ",
            (FileListMode::UnknownConflict, true) => " UNKNOWN ",
        };
        let style = if *mode == state.file_list_mode {
            Style::default()
                .fg(colors.text)
                .bg(colors.border)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors.muted)
        };
        spans.push(Span::styled(label, style));
    }
    Line::from(spans)
}

fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let line = Line::from(vec![
        Span::styled("Tab", Style::default().fg(colors.accent)),
        Span::styled(" switch focus  ", Style::default().fg(colors.muted)),
        Span::styled("↑↓", Style::default().fg(colors.accent)),
        Span::styled(" select  ", Style::default().fg(colors.muted)),
        Span::styled("Enter", Style::default().fg(colors.accent)),
        Span::styled(" expand  ", Style::default().fg(colors.muted)),
        Span::styled("/", Style::default().fg(colors.accent)),
        Span::styled(
            if state.search_query.is_empty() {
                " search  "
            } else {
                " search:on  "
            },
            Style::default().fg(colors.muted),
        ),
        Span::styled("T", Style::default().fg(colors.accent)),
        Span::styled(" theme  ", Style::default().fg(colors.muted)),
        Span::styled("Esc", Style::default().fg(colors.accent)),
        Span::styled(" clear  ", Style::default().fg(colors.muted)),
        Span::styled("r", Style::default().fg(colors.accent)),
        Span::styled(
            if state.follow_mode {
                " follow:on  "
            } else {
                " follow:off  "
            },
            Style::default().fg(colors.muted),
        ),
        Span::styled("q", Style::default().fg(colors.accent)),
        Span::styled(" quit", Style::default().fg(colors.muted)),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.bg).fg(colors.text)),
        area,
    );
}

fn render_title_bar(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let search = if state.search_query.is_empty() {
        String::new()
    } else if state.search_active {
        format!("  search:/{}_", state.search_query)
    } else {
        format!("  search:/{}", state.search_query)
    };
    let line = Line::from(vec![
        Span::styled(
            " AgentWatch ",
            Style::default()
                .fg(colors.text)
                .bg(colors.accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  repo:{}  branch:{}  ", state.repo_name, state.branch),
            Style::default().fg(colors.text).bg(colors.surface),
        ),
        Span::styled(
            format!("rpc:{}  ", state.runtime_transport),
            Style::default().fg(colors.accent).bg(colors.surface),
        ),
        Span::styled(
            if state.follow_mode { "WATCH" } else { "PAUSED" },
            Style::default()
                .fg(if state.follow_mode { ACTIVE } else { IDLE })
                .bg(colors.surface)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  files:{}  ", state.file_list_mode.label()),
            Style::default().fg(colors.accent).bg(colors.surface),
        ),
        Span::styled(
            format!("  refreshed {} ago  ", time_ago(state.last_refresh_at_ms)),
            Style::default().fg(colors.muted).bg(colors.surface),
        ),
        Span::styled(search, Style::default().fg(colors.muted).bg(colors.surface)),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.surface)),
        area,
    );
}

fn panel_block<T: Into<ratatui::text::Line<'static>>>(
    title: T,
    focused: bool,
    colors: UiPalette,
) -> Block<'static> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(panel_border_style(focused, colors))
        .style(Style::default().bg(colors.surface).fg(colors.text))
}

fn panel_border_style(active: bool, colors: UiPalette) -> Style {
    if active {
        Style::default()
            .fg(colors.accent)
            .bg(colors.surface)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(colors.border)
    }
}

fn row_style(selected: bool, focused: bool, colors: UiPalette) -> Style {
    if selected {
        Style::default()
            .fg(colors.text)
            .bg(if focused {
                colors.selection_focus
            } else {
                colors.selection_blur
            })
            .add_modifier(if focused {
                Modifier::BOLD
            } else {
                Modifier::empty()
            })
    } else {
        Style::default().fg(colors.text).bg(colors.surface)
    }
}

fn format_ts(timestamp_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

pub(super) fn time_ago(timestamp_ms: i64) -> String {
    let delta = (chrono::Utc::now().timestamp_millis() - timestamp_ms).max(0) / 1000;
    if delta < 60 {
        format!("{delta}s")
    } else if delta < 3600 {
        format!("{}m", delta / 60)
    } else if delta < 86_400 {
        format!("{}h", delta / 3600)
    } else {
        format!("{}d", delta / 86_400)
    }
}

fn time_label(timestamp_ms: i64) -> String {
    format!("{} ({})", format_ts(timestamp_ms), time_ago(timestamp_ms))
}

fn collect_file_facts(repo_root: &str, rel_path: &str) -> FileFacts {
    let path = Path::new(repo_root).join(rel_path);
    let content = std::fs::read_to_string(&path).ok();
    let line_count = content.as_ref().map(|text| text.lines().count()).unwrap_or(0);
    let byte_size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let (created_at, git_change_count) = git_file_history(repo_root, rel_path)
        .unwrap_or_else(|| ("untracked".to_string(), 0));
    FileFacts {
        line_count,
        byte_size,
        created_at,
        git_change_count,
    }
}

fn git_file_history(repo_root: &str, rel_path: &str) -> Option<(String, usize)> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("log")
        .arg("--follow")
        .arg("--format=%ad")
        .arg("--date=short")
        .arg("--")
        .arg(rel_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let lines: Vec<&str> = stdout.lines().filter(|line| !line.trim().is_empty()).collect();
    let created_at = lines.last().copied().unwrap_or("untracked").to_string();
    Some((created_at, lines.len()))
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

fn render_file_secondary_line(
    file: &crate::models::FileView,
    diff_stat: &DiffStatSummary,
    colors: UiPalette,
) -> Line<'static> {
    let age = pad_left(&time_ago(file.last_modified_at_ms), 5);
    let owner = pad_right(
        &shorten_path(
            &file
                .last_session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
            14,
        ),
        14,
    );
    let mut spans = render_diff_stat_spans(diff_stat);
    spans.push(Span::raw(" "));
    spans.push(Span::styled(age, Style::default().fg(colors.muted)));
    spans.push(Span::raw("  "));
    spans.push(Span::styled(owner, Style::default().fg(colors.accent)));
    Line::from(spans)
}

fn pad_right(value: &str, width: usize) -> String {
    format!("{value:<width$}")
}

fn pad_left(value: &str, width: usize) -> String {
    format!("{value:>width$}")
}

pub(super) fn render_diff_stat_spans(diff_stat: &DiffStatSummary) -> Vec<Span<'static>> {
    let mut spans = vec![Span::styled(
        pad_right(&diff_stat.status, 2),
        Style::default()
            .fg(change_color_from_status(diff_stat.status.as_str()))
            .add_modifier(Modifier::BOLD),
    )];
    if let Some(add) = diff_stat.additions {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(format!("+{add}"), Style::default().fg(ACTIVE)));
    }
    if let Some(del) = diff_stat.deletions {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(format!("-{del}"), Style::default().fg(STOPPED)));
    }
    spans.push(Span::styled(
        pad_right("", 9usize.saturating_sub(diff_stat_display_width(diff_stat))),
        Style::default(),
    ));
    spans
}

fn diff_stat_display_width(diff_stat: &DiffStatSummary) -> usize {
    let mut width = diff_stat.status.len();
    if let Some(add) = diff_stat.additions {
        width += 1 + format!("+{add}").len();
    }
    if let Some(del) = diff_stat.deletions {
        width += 1 + format!("-{del}").len();
    }
    width
}

fn change_color_from_status(status: &str) -> Color {
    match status {
        "D" => STOPPED,
        "A" => ACTIVE,
        _ => INFERRED,
    }
}

fn confidence_text_color(label: &str) -> Color {
    match label {
        "exact" => ACTIVE,
        "inferred" => INFERRED,
        _ => IDLE,
    }
}

fn status_badge(status: &str) -> Span<'static> {
    let (label, color) = match status {
        "active" => (" ACTIVE ", ACTIVE),
        "stopped" => (" STOP ", STOPPED),
        "unknown" => (" UNKNOWN ", IDLE),
        "idle" => (" IDLE ", IDLE),
        _ => (" IDLE ", IDLE),
    };
    Span::styled(
        label,
        Style::default()
            .fg(Color::Rgb(18, 22, 28))
            .bg(color)
            .add_modifier(Modifier::BOLD),
    )
}

fn source_color(source: crate::models::EventSource) -> Color {
    match source {
        crate::models::EventSource::Hook => Color::Rgb(126, 156, 181),
        crate::models::EventSource::Git => INFERRED,
        crate::models::EventSource::Watch => ACTIVE,
    }
}

fn shorten_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        return path.to_string();
    }
    let keep = max_len.saturating_sub(3);
    format!("...{}", &path[path.len().saturating_sub(keep)..])
}
