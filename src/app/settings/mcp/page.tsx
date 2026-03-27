"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { McpServersTab } from "@/client/components/settings-panel-mcp-tab";

export default function McpSettingsPage() {
  return (
    <SettingsRouteShell
      title="MCP Servers"
      description="Manage Model Context Protocol servers, transports, and local integration points for your workspace."
    >
      <div className="h-full overflow-y-auto px-6 py-6">
        <McpServersTab />
      </div>
    </SettingsRouteShell>
  );
}
