"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { WorkflowPanel } from "@/client/components/workflow-panel";

export default function WorkflowSettingsPage() {
  return (
    <SettingsRouteShell
      title="Workflows"
      description="Compose and run recurring workflows that coordinate multiple actions, triggers, and agents."
    >
      <div className="h-full overflow-y-auto px-6 py-6">
        <WorkflowPanel />
      </div>
    </SettingsRouteShell>
  );
}
