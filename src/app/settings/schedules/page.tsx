"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SchedulePanel } from "@/client/components/schedule-panel";

export default function SchedulesSettingsPage() {
  return (
    <SettingsRouteShell
      title="Schedules"
      description="Run agents automatically on a recurring cron schedule. Use this for audits, cleanup, sync, and regular maintenance jobs."
    >
      <div className="h-full min-h-0 overflow-hidden">
        <div className="border-b border-blue-100 bg-blue-50 px-6 py-3 text-xs text-blue-700 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-400">
          <span className="font-semibold">Tick endpoint:</span>{" "}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono dark:bg-blue-900/30">/api/schedules/tick</code>
          <span className="ml-2">Production can trigger it with Vercel Cron; local runs use the in-process scheduler.</span>
        </div>
        <div className="h-[calc(100%-49px)] overflow-y-auto px-6 py-6">
          <SchedulePanel />
        </div>
      </div>
    </SettingsRouteShell>
  );
}
