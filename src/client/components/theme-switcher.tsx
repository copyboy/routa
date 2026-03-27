"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";

import {
  getStoredThemePreference,
  resolveThemePreference,
  setThemePreference,
  subscribeToThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "../utils/theme";

interface ThemeSwitcherProps {
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
}

export function ThemeSwitcher({ showLabel = false, compact = false, className = "" }: ThemeSwitcherProps) {
  const { t } = useTranslation();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getStoredThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveThemePreference(getStoredThemePreference()),
  );

  useEffect(() => {
    return subscribeToThemePreference((nextThemePreference, nextResolvedTheme) => {
      setThemePreferenceState(nextThemePreference);
      setResolvedTheme(nextResolvedTheme);
    });
  }, []);

  const buttonBaseClassName = compact
    ? "rounded-md p-1.5 transition-colors"
    : "rounded-md px-2 py-1 text-[11px] font-medium transition-colors";

  const renderButton = (nextTheme: Exclude<ThemePreference, "system">) => {
    const active = resolvedTheme === nextTheme;
    const label = nextTheme === "light" ? t.settings.light : t.settings.dark;
    const title = themePreference === "system" ? `${label} · ${t.settings.system}` : label;

    return (
      <button
        key={nextTheme}
        type="button"
        onClick={() => {
          const nextResolvedTheme = setThemePreference(nextTheme);
          setThemePreferenceState(nextTheme);
          setResolvedTheme(nextResolvedTheme);
        }}
        className={`${buttonBaseClassName} ${
          active
            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        }`}
        aria-pressed={active}
        aria-label={label}
        title={title}
      >
        <span className="flex items-center gap-1.5">
          {nextTheme === "light" ? (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v2.25M12 18.75V21M4.72 4.72l1.59 1.59M17.69 17.69l1.59 1.59M3 12h2.25M18.75 12H21M4.72 19.28l1.59-1.59M17.69 6.31l1.59-1.59M15.75 12A3.75 3.75 0 118.25 12a3.75 3.75 0 017.5 0z"
              />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12.79A9 9 0 1111.21 3c-.04.3-.06.6-.06.91A7.5 7.5 0 0018.09 11c.31 0 .61-.02.91-.06z"
              />
            </svg>
          )}
          {!compact ? <span>{label}</span> : null}
        </span>
      </button>
    );
  };

  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-[#111423] ${className}`}
    >
      {showLabel ? (
        <span className="px-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t.settings.theme}
        </span>
      ) : null}
      {renderButton("light")}
      {renderButton("dark")}
    </div>
  );
}
