"use client";

import { useTranslation } from "@/i18n";

type StatCardProps = {
  label: string;
  value: string | number;
  max?: string | number;
  description?: string;
  trend?: "up" | "down" | "stable" | string;
  color?: "emerald" | "amber" | "blue" | "violet" | "red";
  icon?: React.ReactNode;
};

const COLOR_CLASSES = {
  emerald: {
    border: "border-emerald-200/60 dark:border-emerald-800/40",
    bg: "bg-emerald-50/50 dark:bg-emerald-950/20",
    text: "text-emerald-900 dark:text-emerald-100",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  amber: {
    border: "border-amber-200/60 dark:border-amber-800/40",
    bg: "bg-amber-50/50 dark:bg-amber-950/20",
    text: "text-amber-900 dark:text-amber-100",
    accent: "text-amber-600 dark:text-amber-400",
  },
  blue: {
    border: "border-blue-200/60 dark:border-blue-800/40",
    bg: "bg-blue-50/50 dark:bg-blue-950/20",
    text: "text-blue-900 dark:text-blue-100",
    accent: "text-blue-600 dark:text-blue-400",
  },
  violet: {
    border: "border-violet-200/60 dark:border-violet-800/40",
    bg: "bg-violet-50/50 dark:bg-violet-950/20",
    text: "text-violet-900 dark:text-violet-100",
    accent: "text-violet-600 dark:text-violet-400",
  },
  red: {
    border: "border-red-200/60 dark:border-red-800/40",
    bg: "bg-red-50/50 dark:bg-red-950/20",
    text: "text-red-900 dark:text-red-100",
    accent: "text-red-600 dark:text-red-400",
  },
};

function StatCard({ label, value, max, description, trend, color = "blue", icon }: StatCardProps) {
  const colors = COLOR_CLASSES[color];
  
  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-2.5 transition-all hover:shadow-sm`}>
      <div className="flex items-center gap-2">
        {icon && (
          <div className={`shrink-0 ${colors.accent}`}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${colors.text} opacity-75`}>
            {label}
          </div>
          <div className={`mt-0.5 flex items-baseline gap-1 ${colors.text}`}>
            <span className="text-lg font-bold leading-none">
              {value}
            </span>
            {max && (
              <span className="text-[11px] opacity-70">
                / {max}
              </span>
            )}
          </div>
          {description && (
            <div className={`mt-0.5 text-[10px] ${colors.text} opacity-70`}>
              {description}
            </div>
          )}
          {trend && trend !== "stable" && (
            <div className="mt-1 flex items-center gap-1">
              {trend === "up" || (typeof trend === "string" && trend.startsWith("+")) ? (
                <svg className="h-3 w-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              ) : null}
              {trend === "down" || (typeof trend === "string" && trend.startsWith("-")) ? (
                <svg className="h-3 w-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              ) : null}
              <span className="text-[10px] font-medium">{trend}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type HarnessHealthScoreCardsProps = {
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
  hookCount?: number;
  workflowCount?: number;
  fitnessScore?: number;
};

export function HarnessHealthScoreCards({
  dimensionCount,
  metricCount,
  hardGateCount,
  hookCount = 0,
  workflowCount = 0,
  fitnessScore,
}: HarnessHealthScoreCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t.settings.harness.healthCards.fitnessScore || "Fitness Score"}
        value={fitnessScore !== undefined ? fitnessScore : dimensionCount > 0 ? "—" : "N/A"}
        max={fitnessScore !== undefined ? 100 : undefined}
        description={`${dimensionCount} dimensions`}
        color="emerald"
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
      <StatCard
        label={t.settings.harness.healthCards.hardGates || "Hard Gates"}
        value={hardGateCount}
        description={`${metricCount} total metrics`}
        color="amber"
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        }
      />
      <StatCard
        label={t.settings.harness.healthCards.hooks || "Hook Systems"}
        value={hookCount}
        description="runtime hooks"
        color="blue"
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        }
      />
      <StatCard
        label={t.settings.harness.healthCards.cicd || "CI/CD"}
        value={workflowCount}
        description="active workflows"
        color="violet"
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        }
      />
    </div>
  );
}

