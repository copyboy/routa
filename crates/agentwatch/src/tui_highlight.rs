use super::*;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use syntect::easy::HighlightLines;
use syntect::highlighting::Style as SyntectStyle;
use syntect::util::LinesWithEndings;

pub(super) fn highlight_diff_text(
    file_path: Option<&str>,
    diff_text: &str,
    theme_mode: ThemeMode,
) -> Text<'static> {
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
        } else if let Some(rest) = raw.strip_prefix('+') {
            build_diff_code_line('+', rest, Color::Green, &mut highlighter, theme_mode)
        } else if let Some(rest) = raw.strip_prefix('-') {
            build_diff_code_line('-', rest, Color::Red, &mut highlighter, theme_mode)
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

pub(super) fn highlight_code_text(
    file_path: Option<&str>,
    code: &str,
    theme_mode: ThemeMode,
) -> Text<'static> {
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
