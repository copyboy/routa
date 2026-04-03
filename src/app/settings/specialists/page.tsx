"use client";

import { useState } from "react";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SpecialistsTab } from "@/client/components/settings-panel-specialists-tab";
import { loadModelDefinitions } from "@/client/components/settings-panel-shared";
import { CircleUser } from "lucide-react";


export default function SpecialistsSettingsPage() {
  const [modelDefs] = useState(() => loadModelDefinitions());

  return (
    <SettingsRouteShell
      title="Specialists"
      description="Create and manage custom specialists, prompts, and model bindings for focused execution roles."
      badgeLabel="Execution roles"
      icon={(
        <CircleUser className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: "Purpose", value: "Focused execution personas" },
        { label: "Binding", value: "Prompt + model pairing" },
      ]}
      contentClassName="flex h-full min-h-0 w-full flex-col px-4 py-4"
    >
      <SpecialistsTab modelDefs={modelDefs} />
    </SettingsRouteShell>
  );
}
