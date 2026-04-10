use crate::ipc::RuntimeFeed;
use crate::models::{DEFAULT_INFERENCE_WINDOW_MS, DEFAULT_TUI_POLL_MS};
use crate::observe;
use crate::repo::RepoContext;
use crate::state::{DetailMode, EventLogFilter, FocusPane, RuntimeState, ThemeMode};
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::Color;
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::{DefaultTerminal, Frame};
use std::io::stdout;
use std::path::Path;
use std::process::Command;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use syntect::easy::HighlightLines;
use syntect::highlighting::{Style as SyntectStyle, Theme, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

static SYNTAX_SET: LazyLock<SyntaxSet> = LazyLock::new(SyntaxSet::load_defaults_newlines);
static LIGHT_THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("InspiredGitHub")
        .cloned()
        .or_else(|| themes.themes.values().next().cloned())
        .expect("at least one syntax theme")
});
static DARK_THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("base16-ocean.dark")
        .cloned()
        .or_else(|| themes.themes.get("base16-eighties.dark").cloned())
        .or_else(|| themes.themes.values().next().cloned())
        .expect("at least one syntax theme")
});

pub fn run(ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    enable_raw_mode().context("enable raw mode")?;
    execute!(stdout(), EnterAlternateScreen).context("enter alternate screen")?;
    let mut terminal = ratatui::init();
    let result = run_loop(&mut terminal, ctx, poll_interval_ms.max(200));
    ratatui::restore();
    let _ = execute!(stdout(), LeaveAlternateScreen);
    let _ = disable_raw_mode();
    result
}

fn run_loop(terminal: &mut DefaultTerminal, ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    let mut feed = RuntimeFeed::open(&ctx.runtime_event_path)?;
    let mut state = RuntimeState::new(ctx.repo_root.to_string_lossy().to_string());
    let bootstrap_cutoff = chrono::Utc::now().timestamp_millis() - DEFAULT_INFERENCE_WINDOW_MS;
    for message in feed.read_recent_since(bootstrap_cutoff)? {
        state.apply_message(message);
    }
    let mut last_poll = Instant::now() - Duration::from_millis(poll_interval_ms);

    loop {
        if last_poll.elapsed() >= Duration::from_millis(poll_interval_ms) {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        for message in feed.read_new()? {
            state.apply_message(message);
        }

        terminal.draw(|frame| render(frame, &state, &feed))?;

        if event::poll(Duration::from_millis(100)).context("poll terminal events")? {
            if handle_event(&mut state, &ctx)? {
                break;
            }
        }
    }
    Ok(())
}

fn handle_event(state: &mut RuntimeState, ctx: &RepoContext) -> Result<bool> {
    match event::read().context("read terminal event")? {
        Event::Key(key) => match key.code {
            KeyCode::Char('q') => return Ok(true),
            KeyCode::Tab => state.cycle_focus(),
            KeyCode::Char('j') | KeyCode::Down => state.move_selection_down(),
            KeyCode::Char('k') | KeyCode::Up => state.move_selection_up(),
            KeyCode::Char('h') | KeyCode::Left => state.select_prev_file(),
            KeyCode::Char('l') | KeyCode::Right => state.select_next_file(),
            KeyCode::Enter => state.toggle_file_view(),
            KeyCode::Char('r') => state.toggle_follow_mode(),
            KeyCode::Char('s') => state.toggle_group_mode(),
            KeyCode::Char('d') | KeyCode::Char('D') => state.toggle_detail_mode(),
            KeyCode::Char('t') | KeyCode::Char('T') => state.toggle_theme_mode(),
            KeyCode::Char('1') => state.set_event_log_filter(EventLogFilter::All),
            KeyCode::Char('2') => state.set_event_log_filter(EventLogFilter::Hook),
            KeyCode::Char('3') => state.set_event_log_filter(EventLogFilter::Git),
            KeyCode::Char('4') => state.set_event_log_filter(EventLogFilter::Watch),
            KeyCode::Char('[') => jump_diff_hunk(state, ctx, false)?,
            KeyCode::Char(']') => jump_diff_hunk(state, ctx, true)?,
            KeyCode::PageDown => {
                for _ in 0..10 {
                    state.move_selection_down();
                }
            }
            KeyCode::PageUp => {
                for _ in 0..10 {
                    state.move_selection_up();
                }
            }
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                return Ok(true);
            }
            _ => {}
        },
        Event::Resize(_, _) => {}
        _ => {}
    }
    Ok(false)
}

fn render(frame: &mut Frame, state: &RuntimeState, feed: &RuntimeFeed) {
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(8),
            Constraint::Length(7),
            Constraint::Length(1),
        ])
        .split(frame.area());

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25),
            Constraint::Percentage(38),
            Constraint::Percentage(37),
        ])
        .split(outer[0]);

    render_sessions(frame, columns[0], state);
    render_files(frame, columns[1], state);
    render_detail(frame, columns[2], state, feed);
    render_log(frame, outer[1], state);
    render_footer(frame, outer[2], state);
}

fn render_sessions(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .session_items()
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let marker = if idx == state.selected_session && state.focus == FocusPane::Sessions {
                ">"
            } else {
                " "
            };
            let model = session.model.clone().unwrap_or_else(|| "-".to_string());
            let line = format!(
                "{marker} {} [{}] {} files {}",
                session.session_id,
                session.status,
                session.touched_files.len(),
                model
            );
            ListItem::new(Line::from(line))
        })
        .collect();

    let title = if state.group_by_session {
        "Sessions (group)"
    } else {
        "Sessions"
    };

    let list = List::new(items).block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(focus_style(state.focus == FocusPane::Sessions)),
    );
    frame.render_widget(list, area);
}

fn render_files(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .file_items()
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let marker = if idx == state.selected_file && state.focus == FocusPane::Files {
                ">"
            } else {
                " "
            };
            let session = file
                .last_session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let line = format!(
                "{marker} {} [{} {} {}]",
                file.rel_path,
                if file.dirty { "dirty" } else { "clean" },
                file.confidence.as_str(),
                session
            );
            ListItem::new(Line::from(line))
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .title("Files")
            .borders(Borders::ALL)
            .border_style(focus_style(state.focus == FocusPane::Files)),
    );
    frame.render_widget(list, area);
}

fn render_detail(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    feed: &RuntimeFeed,
) {
    let mut lines = Vec::new();
    lines.push(Line::from(format!("repo: {}", state.repo_root)));
    lines.push(Line::from(format!(
        "event file: {}",
        feed.event_path().to_string_lossy()
    )));
    lines.push(Line::from(format!(
        "follow={} mode={} detail={} theme={}",
        state.follow_mode,
        if state.group_by_session {
            "session"
        } else {
            "global"
        },
        match state.detail_mode {
            DetailMode::Summary => "summary",
            DetailMode::File => "file",
            DetailMode::Diff => "diff",
        },
        match state.theme_mode {
            ThemeMode::Dark => "dark",
            ThemeMode::Light => "light",
        },
    )));
    lines.push(Line::from(""));

    if let Some((selected_idx, total)) = state.selected_file_position() {
        lines.push(render_file_tabs(state, selected_idx, total));
        lines.push(Line::from(""));
    }

    let title = match state.detail_mode {
        DetailMode::Summary => "Detail",
        DetailMode::File => "File",
        DetailMode::Diff => "Diff",
    };

    match state.detail_mode {
        DetailMode::Summary => {
            if let Some(session_id) = state.selected_session_id() {
                lines.push(Line::from(Span::styled(
                    format!("session: {session_id}"),
                    Style::default().add_modifier(Modifier::BOLD),
                )));
            }

            if let Some(file) = state.selected_file() {
                lines.push(Line::from(format!("file: {}", file.rel_path)));
                lines.push(Line::from(format!(
                    "last session: {}",
                    file.last_session_id
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string())
                )));
                lines.push(Line::from(format!(
                    "confidence: {} conflicted={}",
                    file.confidence.as_str(),
                    file.conflicted
                )));
                lines.push(Line::from(format!(
                    "state: {} dirty={}",
                    file.state_code, file.dirty
                )));
                lines.push(Line::from("recent:"));
                for event in &file.recent_events {
                    lines.push(Line::from(format!("- {event}")));
                }
            } else {
                lines.push(Line::from("no file selected"));
            }
            lines.push(Line::from(""));
            lines.push(Line::from("Enter file  D diff  PgUp/PgDn scroll"));
            let detail = Paragraph::new(lines)
                .block(
                    Block::default()
                        .title(title)
                        .borders(Borders::ALL)
                        .border_style(focus_style(state.focus == FocusPane::Detail)),
                )
                .wrap(Wrap { trim: true });
            frame.render_widget(detail, area);
        }
        DetailMode::File => {
            let file_text = state
                .selected_file()
                .map(|file| load_file_preview(&state.repo_root, file.rel_path.as_str()))
                .transpose()
                .unwrap_or_else(|err| Some(Some(format!("file preview failed: {err}"))))
                .flatten()
                .unwrap_or_else(|| "<no file content available>".to_string());
            let file_path = state.selected_file().map(|file| file.rel_path.as_str());
            let preview = Paragraph::new(highlight_code_text(file_path, &file_text, state.theme_mode))
                .block(
                    Block::default()
                        .title(title)
                        .borders(Borders::ALL)
                        .border_style(focus_style(state.focus == FocusPane::Detail)),
                )
                .wrap(Wrap { trim: false })
                .scroll((state.detail_scroll, 0));
            frame.render_widget(preview, area);
        }
        DetailMode::Diff => {
            let diff_text = state
                .selected_file()
                .map(|file| {
                    load_diff_text(
                        &state.repo_root,
                        file.rel_path.as_str(),
                        file.state_code.as_str(),
                    )
                })
                .transpose()
                .unwrap_or_else(|err| Some(Some(format!("diff load failed: {err}"))))
                .flatten()
                .unwrap_or_else(|| "<no diff available>".to_string());
            let file_path = state.selected_file().map(|file| file.rel_path.as_str());

            let diff = Paragraph::new(highlight_diff_text(file_path, &diff_text, state.theme_mode))
                .block(
                    Block::default()
                        .title(title)
                        .borders(Borders::ALL)
                        .border_style(focus_style(state.focus == FocusPane::Detail)),
                )
                .wrap(Wrap { trim: false })
                .scroll((state.detail_scroll, 0));
            frame.render_widget(diff, area);
        }
    }
}

fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .visible_event_log_items()
        .iter()
        .take(6)
        .map(|entry| {
            ListItem::new(Line::from(format!(
                "{} [{}] {}",
                format_ts(entry.observed_at_ms),
                entry.source.label(),
                entry.message
            )))
        })
        .collect();
    let list = List::new(items).block(
        Block::default()
            .title(format!("Event Log ({})", state.event_log_filter.label()))
            .borders(Borders::ALL),
    );
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

fn render_file_tabs(state: &RuntimeState, selected_idx: usize, total: usize) -> Line<'static> {
    let items = state.file_items();
    let start = selected_idx.saturating_sub(1);
    let end = (start + 3).min(total);
    let mut spans = Vec::new();
    for (idx, file) in items.iter().enumerate().take(end).skip(start) {
        if idx > start {
            spans.push(Span::raw(" "));
        }
        let label = format!(
            "{} {}",
            if idx == selected_idx { ">" } else { "-" },
            shorten_path(&file.rel_path, 18)
        );
        let style = if idx == selected_idx {
            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::DarkGray)
        };
        spans.push(Span::styled(label, style));
    }
    if end < total {
        spans.push(Span::raw(" ..."));
    }
    Line::from(spans)
}

fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let line = Line::from(vec![
        Span::styled("Tab", Style::default().fg(Color::Yellow)),
        Span::raw(" focus  "),
        Span::styled("j/k", Style::default().fg(Color::Yellow)),
        Span::raw(" move  "),
        Span::styled("h/l", Style::default().fg(Color::Yellow)),
        Span::raw(" file  "),
        Span::styled("Enter", Style::default().fg(Color::Yellow)),
        Span::raw(" preview  "),
        Span::styled("D", Style::default().fg(Color::Yellow)),
        Span::raw(" diff  "),
        Span::styled("[ ]", Style::default().fg(Color::Yellow)),
        Span::raw(" hunk  "),
        Span::styled("s", Style::default().fg(Color::Yellow)),
        Span::raw(if state.group_by_session {
            " global  "
        } else {
            " grouped  "
        }),
        Span::styled("T", Style::default().fg(Color::Yellow)),
        Span::raw(" theme  "),
        Span::styled("1-4", Style::default().fg(Color::Yellow)),
        Span::raw(" log  "),
        Span::styled("r", Style::default().fg(Color::Yellow)),
        Span::raw(if state.follow_mode {
            " follow:on  "
        } else {
            " follow:off  "
        }),
        Span::styled("PgUp/PgDn", Style::default().fg(Color::Yellow)),
        Span::raw(" scroll  "),
        Span::styled("q", Style::default().fg(Color::Yellow)),
        Span::raw(" quit"),
    ]);
    frame.render_widget(Paragraph::new(line), area);
}

fn focus_style(active: bool) -> Style {
    if active {
        Style::default().yellow().add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    }
}

fn format_ts(timestamp_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

fn load_diff_text(repo_root: &str, rel_path: &str, state_code: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if state_code == "untracked" {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).context("read untracked file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {}", rel_path));
        for line in content.lines().take(200) {
            out.push(format!("+{line}"));
        }
        return Ok(Some(out.join("\n")));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--no-ext-diff")
        .arg("--no-color")
        .arg("--")
        .arg(rel_path)
        .output()
        .context("run git diff")?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8(output.stdout).context("decode git diff output")?;
    if text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

fn load_file_preview(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).context("read file preview")?;
    let truncated = content.lines().take(400).collect::<Vec<_>>().join("\n");
    Ok(Some(truncated))
}

fn highlight_diff_text(file_path: Option<&str>, diff_text: &str, theme_mode: ThemeMode) -> Text<'static> {
    let syntax = file_path
        .and_then(|path| SYNTAX_SET.find_syntax_for_file(path).ok().flatten())
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_plain_text());
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_mode));
    let mut lines = Vec::new();
    for raw in diff_text.lines() {
        let line = if raw.starts_with("+++") || raw.starts_with("---") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Yellow),
            ))
        } else if raw.starts_with("@@") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Cyan),
            ))
        } else if raw.starts_with('+') {
            build_diff_code_line('+', &raw[1..], Color::Green, &mut highlighter, theme_mode)
        } else if raw.starts_with('-') {
            build_diff_code_line('-', &raw[1..], Color::Red, &mut highlighter, theme_mode)
        } else if let Some(rest) = raw.strip_prefix(' ') {
            build_diff_code_line(' ', rest, Color::DarkGray, &mut highlighter, theme_mode)
        } else if raw.starts_with("diff --git") || raw.starts_with("index ") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::DarkGray),
            ))
        } else {
            Line::from(raw.to_string())
        };
        lines.push(line);
    }
    Text::from(lines)
}

fn build_diff_code_line(
    prefix: char,
    code: &str,
    prefix_color: Color,
    highlighter: &mut HighlightLines<'_>,
    theme_mode: ThemeMode,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        prefix.to_string(),
        Style::default()
            .fg(prefix_color)
            .add_modifier(Modifier::BOLD),
    )];
    spans.extend(highlight_code_spans(code, highlighter, theme_mode));
    Line::from(spans)
}

fn highlight_code_text(file_path: Option<&str>, code: &str, theme_mode: ThemeMode) -> Text<'static> {
    let syntax = file_path
        .and_then(|path| SYNTAX_SET.find_syntax_for_file(path).ok().flatten())
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_plain_text());
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_mode));
    let mut lines = Vec::new();
    for line in LinesWithEndings::from(code) {
        lines.push(Line::from(highlight_code_spans(
            line.trim_end_matches('\n'),
            &mut highlighter,
            theme_mode,
        )));
    }
    Text::from(lines)
}

fn highlight_code_spans(
    code: &str,
    highlighter: &mut HighlightLines<'_>,
    theme_mode: ThemeMode,
) -> Vec<Span<'static>> {
    match highlighter.highlight_line(code, &SYNTAX_SET) {
        Ok(regions) => regions
            .into_iter()
            .map(|(style, text)| {
                Span::styled(text.to_string(), syntect_to_ratatui(style, theme_mode))
            })
            .collect(),
        Err(_) => vec![Span::raw(code.to_string())],
    }
}

fn syntect_to_ratatui(style: SyntectStyle, theme_mode: ThemeMode) -> Style {
    let color = Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b);
    let color = match theme_mode {
        ThemeMode::Dark => normalize_dark_foreground(color),
        ThemeMode::Light => color,
    };
    Style::default().fg(color)
}

fn syntax_theme(theme_mode: ThemeMode) -> &'static Theme {
    match theme_mode {
        ThemeMode::Dark => &DARK_THEME,
        ThemeMode::Light => &LIGHT_THEME,
    }
}

fn normalize_dark_foreground(color: Color) -> Color {
    match color {
        Color::Rgb(r, g, b) => {
            let brightest = r.max(g).max(b);
            if brightest >= 95 {
                Color::Rgb(r, g, b)
            } else {
                let boost = 95u8.saturating_sub(brightest);
                Color::Rgb(
                    r.saturating_add(boost),
                    g.saturating_add(boost),
                    b.saturating_add(boost),
                )
            }
        }
        other => other,
    }
}

fn jump_diff_hunk(state: &mut RuntimeState, ctx: &RepoContext, forward: bool) -> Result<()> {
    let Some((rel_path, state_code)) = state
        .selected_file()
        .map(|file| (file.rel_path.clone(), file.state_code.clone()))
    else {
        return Ok(());
    };
    let diff_text = load_diff_text(&ctx.repo_root.to_string_lossy(), &rel_path, &state_code)?
        .unwrap_or_default();
    let hunks = diff_hunk_offsets(&diff_text);
    if hunks.is_empty() {
        return Ok(());
    }
    let current = state.detail_scroll as usize;
    let target = if forward {
        hunks.iter()
            .copied()
            .find(|offset| *offset > current)
            .unwrap_or(hunks[0])
    } else {
        hunks.iter()
            .copied()
            .rev()
            .find(|offset| *offset < current)
            .unwrap_or(*hunks.last().unwrap_or(&0))
    };
    state.detail_scroll = target.min(u16::MAX as usize) as u16;
    state
        .detail_scroll_cache
        .insert(rel_path, state.detail_scroll);
    Ok(())
}

fn diff_hunk_offsets(diff_text: &str) -> Vec<usize> {
    diff_text
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| line.starts_with("@@").then_some(idx))
        .collect()
}

fn shorten_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        return path.to_string();
    }
    let keep = max_len.saturating_sub(3);
    format!("...{}", &path[path.len().saturating_sub(keep)..])
}

#[allow(dead_code)]
pub fn default_poll_ms() -> u64 {
    DEFAULT_TUI_POLL_MS
}
