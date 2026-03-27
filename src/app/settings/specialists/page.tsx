"use client";

import { useState } from "react";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SpecialistsTab } from "@/client/components/settings-panel-specialists-tab";
import { loadModelDefinitions } from "@/client/components/settings-panel-shared";

export default function SpecialistsSettingsPage() {
  const [modelDefs] = useState(() => loadModelDefinitions());

  return (
    <SettingsRouteShell
      title="Specialists"
      description="Create and manage custom specialists, prompts, and model bindings for focused execution roles."
    >
      <div className="h-full overflow-y-auto px-6 py-6">
        <SpecialistsTab modelDefs={modelDefs} />
      </div>
    </SettingsRouteShell>
  );
}
