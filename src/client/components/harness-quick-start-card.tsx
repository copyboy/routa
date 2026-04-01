"use client";

import { useTranslation } from "@/i18n";

type QuickStartAction = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
};

type HarnessQuickStartCardProps = {
  dimensionCount: number;
  metricCount?: number;
  hardGateCount?: number;
  hookCount?: number;
  workflowCount?: number;
  onNavigateToSection: (sectionId: string) => void;
};

export function HarnessQuickStartCard({
  dimensionCount,
  metricCount: _metricCount = 0,
  hardGateCount = 0,
  hookCount = 0,
  workflowCount = 0,
  onNavigateToSection,
}: HarnessQuickStartCardProps) {
  const { t } = useTranslation();

  const actions: QuickStartAction[] = [
    {
      id: "fitness",
      title: t.settings.harness.quickStart.viewQualityDimensions || "查看质量维度",
      description: `检查 Entrix Fitness 的 ${dimensionCount} 个维度`,
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      onClick: () => onNavigateToSection("entrix-fitness"),
    },
    {
      id: "hooks",
      title: t.settings.harness.quickStart.reviewHooks || "审查 Hook 配置",
      description: `确认 ${hookCount} 个 runtime hooks`,
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      onClick: () => onNavigateToSection("hook-systems"),
    },
    {
      id: "cicd",
      title: t.settings.harness.quickStart.checkCICD || "检查 CI/CD 流程",
      description: `查看 ${workflowCount} 个 GitHub Actions workflows`,
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      onClick: () => onNavigateToSection("ci-cd"),
    },
  ];

  const stats = [
    { label: "Fitness", value: dimensionCount, color: "emerald", section: "entrix-fitness" },
    { label: "Gates", value: hardGateCount, color: "amber", section: "entrix-fitness" },
    { label: "Hooks", value: hookCount, color: "blue", section: "hook-systems" },
    { label: "Workflows", value: workflowCount, color: "violet", section: "ci-cd" },
  ];

  const colorClasses = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
    violet: "text-violet-600 dark:text-violet-400",
  };

  const StatItem = ({ stat }: { stat: typeof stats[0] }) => (
    <button
      onClick={() => onNavigateToSection(stat.section)}
      className="flex items-center gap-2 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 py-1.5 transition-colors hover:bg-desktop-bg-active"
    >
      <div className={`text-[14px] font-bold leading-none ${colorClasses[stat.color as keyof typeof colorClasses]}`}>
        {stat.value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-desktop-text-secondary">
        {stat.label}
      </div>
    </button>
  );

  return (
    <div className="rounded-lg border border-desktop-border bg-desktop-bg-secondary/80 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <svg className="h-4 w-4 text-desktop-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <h2 className="text-[12px] font-semibold text-desktop-text-primary">
          {t.settings.harness.quickStart.title || "快速开始"}
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto]">
        {/* Left: Health Metrics */}
        <div className="grid grid-cols-2 gap-1.5">
          {stats.map((stat) => (
            <StatItem key={stat.label} stat={stat} />
          ))}
        </div>

        {/* Right: Quick Actions */}
        <div className="flex flex-col gap-1.5">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={action.onClick}
              className="group flex items-center gap-1.5 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 py-1.5 text-left transition-colors hover:bg-desktop-bg-active"
            >
              <div className="shrink-0 text-desktop-accent">
                {action.icon}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold leading-tight text-desktop-text-primary">
                  {action.title}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

