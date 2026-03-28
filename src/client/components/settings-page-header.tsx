"use client";

import type { ReactNode } from "react";

type SettingsPageHeaderProps = {
  title: string;
  description: string;
  metadata?: Array<{ label: string; value: string }>;
  extra?: ReactNode;
};

export function SettingsPageHeader({
  title,
  description,
  metadata = [],
  extra,
}: SettingsPageHeaderProps) {
  return (
    <header className="mb-4 border-b border-desktop-border pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold text-desktop-text-primary">{title}</h1>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-desktop-text-secondary">{description}</p>
          {extra ? <div className="mt-3">{extra}</div> : null}
        </div>

        {metadata.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {metadata.map((item) => (
              <div
                key={item.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary"
              >
                <span>{item.label}:</span>
                <span className="text-desktop-text-primary">{item.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
