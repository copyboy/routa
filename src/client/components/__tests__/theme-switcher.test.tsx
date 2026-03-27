import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  getStoredThemePreference,
  resolveThemePreference,
  setThemePreference,
  subscribeToThemePreference,
} = vi.hoisted(() => ({
  getStoredThemePreference: vi.fn(() => "light"),
  resolveThemePreference: vi.fn(() => "light"),
  setThemePreference: vi.fn((theme: "light" | "dark") => theme),
  subscribeToThemePreference: vi.fn(() => () => {}),
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      settings: {
        theme: "Theme",
        light: "Light",
        dark: "Dark",
        system: "System",
      },
    },
  }),
}));

vi.mock("../../utils/theme", () => ({
  getStoredThemePreference,
  resolveThemePreference,
  setThemePreference,
  subscribeToThemePreference,
}));

import { ThemeSwitcher } from "../theme-switcher";

describe("ThemeSwitcher", () => {
  it("renders the theme label when requested", () => {
    render(<ThemeSwitcher showLabel />);

    expect(screen.getByText("Theme")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Light" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Dark" })).not.toBeNull();
  });

  it("updates the theme preference when a button is clicked", () => {
    render(<ThemeSwitcher compact />);

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(setThemePreference).toHaveBeenCalledWith("dark");
  });
});
