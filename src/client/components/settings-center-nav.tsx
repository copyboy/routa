"use client";

import Link from "next/link";

import type { SettingsTab } from "./settings-panel-shared";

interface SettingsCenterNavProps {
  activeConfigTab?: SettingsTab;
  onBack: () => void;
}

const CONFIG_ITEMS: Array<{ key: SettingsTab; label: string; href: string }> = [
  { key: "providers", label: "Providers", href: "/settings?tab=providers" },
  { key: "roles", label: "Roles", href: "/settings?tab=roles" },
  { key: "models", label: "Models", href: "/settings?tab=models" },
  { key: "webhooks", label: "Webhooks", href: "/settings?tab=webhooks" },
];

export function SettingsCenterNav({ activeConfigTab, onBack }: SettingsCenterNavProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary px-4 py-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        <span>Back to app</span>
      </button>

      <div className="mt-8 space-y-6">
        <NavGroup
          label="Config"
          items={CONFIG_ITEMS.map((item) => ({
            ...item,
            active: activeConfigTab === item.key,
          }))}
        />
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  items,
}: {
  label: string;
  items: Array<{ key: string; label: string; href: string; active: boolean }>;
}) {
  return (
    <div>
      <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">
        {label}
      </p>
      <div className="mt-2 space-y-1">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`flex items-center rounded-xl px-3 py-2 text-sm transition-colors ${
              item.active
                ? "bg-desktop-bg-active text-desktop-accent"
                : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
