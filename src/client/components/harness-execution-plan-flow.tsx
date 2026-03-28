"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

export type RunnerKind = "shell" | "graph" | "sarif";
export type TierValue = "fast" | "normal" | "deep";
export type ScopeValue = "local" | "ci" | "staging" | "prod_observation";

export type PlannedMetric = {
  name: string;
  command: string;
  description: string;
  tier: TierValue;
  gate: string;
  hardGate: boolean;
  runner: RunnerKind;
  executionScope: ScopeValue;
};

export type PlannedDimension = {
  name: string;
  weight: number;
  thresholdPass: number;
  thresholdWarn: number;
  sourceFile: string;
  metrics: PlannedMetric[];
};

export type PlanResponse = {
  generatedAt: string;
  tier: TierValue;
  scope: ScopeValue;
  repoRoot: string;
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
  runnerCounts: Record<RunnerKind, number>;
  dimensions: PlannedDimension[];
};

type PlanNodeKind = "root" | "stage" | "dimension" | "metric";
type EdgeStatus = "hard" | "warn" | "pass" | "blocked" | "flow";

type PlanNodeData = {
  kind: PlanNodeKind;
  title: string;
  subtitle?: string;
  meta?: string[];
  status?: EdgeStatus;
  expanded?: boolean;
  onToggle?: () => void;
};

type HarnessExecutionPlanFlowProps = {
  loading: boolean;
  error: string | null;
  plan: PlanResponse | null;
  repoLabel: string;
  selectedTier: TierValue;
  onTierChange: (tier: TierValue) => void;
};

function getStatusTone(status: EdgeStatus | undefined) {
  switch (status) {
    case "hard":
      return {
        badge: "border-red-200 bg-red-50 text-red-700",
        border: "border-red-200",
        shadow: "shadow-red-100/80",
      };
    case "warn":
      return {
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        border: "border-amber-200",
        shadow: "shadow-amber-100/80",
      };
    case "pass":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        border: "border-emerald-200",
        shadow: "shadow-emerald-100/80",
      };
    case "blocked":
      return {
        badge: "border-slate-300 bg-slate-100 text-slate-700",
        border: "border-slate-300",
        shadow: "shadow-slate-200/80",
      };
    default:
      return {
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        border: "border-desktop-border",
        shadow: "shadow-black/5",
      };
  }
}

function FlowNode({ data }: NodeProps<Node<PlanNodeData>>) {
  const tone = getStatusTone(data.status);
  const interactive = typeof data.onToggle === "function";

  return (
    <button
      type="button"
      onClick={() => {
        data.onToggle?.();
      }}
      className={`min-w-[220px] rounded-2xl border bg-desktop-bg-primary/95 px-4 py-3 text-left shadow-sm transition ${tone.border} ${tone.shadow} ${interactive ? "cursor-pointer hover:bg-desktop-bg-secondary/90" : "cursor-default"}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-desktop-border" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-desktop-border" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{data.kind}</div>
          <div className="mt-1 text-[13px] font-semibold text-desktop-text-primary">{data.title}</div>
          {data.subtitle ? (
            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{data.subtitle}</div>
          ) : null}
        </div>
        {data.status ? (
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>
            {data.status}
          </span>
        ) : null}
      </div>
      {data.meta && data.meta.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.meta.map((item) => (
            <span key={item} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {interactive ? (
        <div className="mt-3 text-[10px] text-desktop-text-secondary">
          {data.expanded ? "Click to collapse metrics" : "Click to expand metrics"}
        </div>
      ) : null}
    </button>
  );
}

const nodeTypes = {
  planNode: FlowNode,
};

function buildEdgeStyle(status: EdgeStatus) {
  switch (status) {
    case "hard":
      return { stroke: "#dc2626", strokeWidth: 1.8 };
    case "warn":
      return { stroke: "#d97706", strokeWidth: 1.8 };
    case "pass":
      return { stroke: "#059669", strokeWidth: 1.8 };
    case "blocked":
      return { stroke: "#64748b", strokeWidth: 1.8, strokeDasharray: "6 4" };
    default:
      return { stroke: "#94a3b8", strokeWidth: 1.4 };
  }
}

function buildPlanGraph(
  plan: PlanResponse,
  expandedDimensions: Set<string>,
  toggleDimension: (name: string) => void,
): { nodes: Node<PlanNodeData>[]; edges: Edge[]; minHeight: number } {
  const nodes: Node<PlanNodeData>[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "root",
    type: "planNode",
    position: { x: 24, y: 36 },
    data: {
      kind: "root",
      title: "Execution Plan",
      subtitle: `${plan.dimensionCount} dimensions · ${plan.metricCount} metrics`,
      meta: [`tier ${plan.tier}`, `scope ${plan.scope}`, `${plan.hardGateCount} hard gates`],
    },
    draggable: false,
    selectable: false,
  });

  const stages = [
    {
      id: "filter",
      x: 320,
      title: "Filter",
      subtitle: "Tier and scope determine which dimensions and metrics survive planning.",
      meta: [`tier <= ${plan.tier}`, `scope = ${plan.scope}`, `${plan.dimensionCount} dimensions`],
      status: "pass" as EdgeStatus,
    },
    {
      id: "dispatch",
      x: 620,
      title: "Dispatch",
      subtitle: "Each admitted metric is mapped to shell, graph, or sarif execution.",
      meta: [
        `shell ${plan.runnerCounts.shell}`,
        `graph ${plan.runnerCounts.graph}`,
        `sarif ${plan.runnerCounts.sarif}`,
      ],
      status: "pass" as EdgeStatus,
    },
    {
      id: "gates",
      x: 920,
      title: "Gates",
      subtitle: "Hard gates can block the final exit code before reporting succeeds.",
      meta: [`${plan.hardGateCount} hard`, "warn tracked", "blocked on failure"],
      status: plan.hardGateCount > 0 ? ("blocked" as EdgeStatus) : ("pass" as EdgeStatus),
    },
    {
      id: "report",
      x: 1220,
      title: "Report",
      subtitle: "Dimension scores roll into the weighted report and final block state.",
      meta: ["weighted score", "dimension thresholds", "final status"],
      status: "pass" as EdgeStatus,
    },
  ];

  stages.forEach((stage) => {
    nodes.push({
      id: stage.id,
      type: "planNode",
      position: { x: stage.x, y: 36 },
      data: {
        kind: "stage",
        title: stage.title,
        subtitle: stage.subtitle,
        meta: stage.meta,
        status: stage.status,
      },
      draggable: false,
      selectable: false,
    });
  });

  edges.push(
    {
      id: "root-filter",
      source: "root",
      target: "filter",
      type: "smoothstep",
      label: "admit plan",
      style: buildEdgeStyle("flow"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
      labelStyle: { fontSize: 10, fill: "#64748b" },
    },
    {
      id: "filter-dispatch",
      source: "filter",
      target: "dispatch",
      type: "smoothstep",
      label: `${plan.dimensionCount} dimensions`,
      style: buildEdgeStyle("pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
      labelStyle: { fontSize: 10, fill: "#059669" },
    },
    {
      id: "dispatch-gates",
      source: "dispatch",
      target: "gates",
      type: "smoothstep",
      label: "gate evaluation",
      style: buildEdgeStyle(plan.hardGateCount > 0 ? "blocked" : "pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
      labelStyle: { fontSize: 10, fill: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
    },
    {
      id: "gates-report",
      source: "gates",
      target: "report",
      type: "smoothstep",
      label: plan.hardGateCount > 0 ? "blocked on hard failure" : "pass to report",
      style: buildEdgeStyle(plan.hardGateCount > 0 ? "blocked" : "pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
      labelStyle: { fontSize: 10, fill: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
    },
  );

  let currentY = 190;
  const dimensionX = 620;
  const metricX = 960;

  plan.dimensions.forEach((dimension) => {
    const expanded = expandedDimensions.has(dimension.name);
    const metricSpacing = 96;
    const dimensionHeight = expanded ? Math.max(140, dimension.metrics.length * metricSpacing + 32) : 112;
    const dimensionY = currentY;
    const dimensionId = `dimension:${dimension.name}`;

    nodes.push({
      id: dimensionId,
      type: "planNode",
      position: { x: dimensionX, y: dimensionY },
      data: {
        kind: "dimension",
        title: dimension.name,
        subtitle: `${dimension.sourceFile} · pass ${dimension.thresholdPass} / warn ${dimension.thresholdWarn}`,
        meta: [`weight ${dimension.weight}`, `${dimension.metrics.length} metrics`],
        status: dimension.metrics.some((metric) => metric.hardGate) ? "hard" : "pass",
        expanded,
        onToggle: () => {
          toggleDimension(dimension.name);
        },
      },
      draggable: false,
      selectable: false,
    });

    edges.push(
      {
        id: `dispatch-${dimensionId}`,
        source: "dispatch",
        target: dimensionId,
        type: "smoothstep",
        label: "pass",
        style: buildEdgeStyle("pass"),
        markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
        labelStyle: { fontSize: 10, fill: "#059669" },
      },
      {
        id: `${dimensionId}-report`,
        source: dimensionId,
        target: "report",
        type: "smoothstep",
        label: `pass ${dimension.thresholdPass} / warn ${dimension.thresholdWarn}`,
        style: buildEdgeStyle("flow"),
        markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
        labelStyle: { fontSize: 10, fill: "#64748b" },
      },
    );

    if (expanded) {
      dimension.metrics.forEach((metric, metricIndex) => {
        const metricId = `${dimensionId}:metric:${metric.name}`;
        const metricY = dimensionY + metricIndex * metricSpacing;
        const edgeStatus: EdgeStatus = metric.hardGate ? "hard" : metric.gate === "warn" ? "warn" : "pass";

        nodes.push({
          id: metricId,
          type: "planNode",
          position: { x: metricX, y: metricY },
          data: {
            kind: "metric",
            title: metric.name,
            subtitle: metric.description || metric.command,
            meta: [metric.runner, metric.tier, metric.executionScope, metric.hardGate ? "hard gate" : metric.gate || "pass"],
            status: edgeStatus,
          },
          draggable: false,
          selectable: false,
        });

        edges.push({
          id: `${dimensionId}-${metricId}`,
          source: dimensionId,
          target: metricId,
          type: "smoothstep",
          label: metric.runner,
          style: buildEdgeStyle("flow"),
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
          labelStyle: { fontSize: 10, fill: "#64748b" },
        });

        edges.push({
          id: `${metricId}-${metric.hardGate ? "gates" : "report"}`,
          source: metricId,
          target: metric.hardGate ? "gates" : "report",
          type: "smoothstep",
          label: metric.hardGate ? "hard" : metric.gate === "warn" ? "warn" : "pass",
          style: buildEdgeStyle(edgeStatus),
          markerEnd: { type: MarkerType.ArrowClosed, color: edgeStatus === "hard" ? "#dc2626" : edgeStatus === "warn" ? "#d97706" : "#059669" },
          labelStyle: { fontSize: 10, fill: edgeStatus === "hard" ? "#dc2626" : edgeStatus === "warn" ? "#d97706" : "#059669" },
        });
      });
    }

    currentY += dimensionHeight + 36;
  });

  return {
    nodes,
    edges,
    minHeight: Math.max(520, currentY + 80),
  };
}

export function HarnessExecutionPlanFlow({
  loading,
  error,
  plan,
  repoLabel,
  selectedTier,
  onTierChange,
}: HarnessExecutionPlanFlowProps) {
  const planKey = useMemo(
    () => (plan ? plan.dimensions.map((dimension) => dimension.name).join("|") : "__empty__"),
    [plan],
  );
  const defaultExpandedDimensions = useMemo(
    () => new Set(plan?.dimensions.slice(0, Math.min(2, plan.dimensions.length)).map((dimension) => dimension.name) ?? []),
    [plan],
  );
  const [expansionState, setExpansionState] = useState<{ planKey: string; expanded: Set<string> }>({
    planKey: "__empty__",
    expanded: new Set(),
  });
  const expandedDimensions = expansionState.planKey === planKey
    ? expansionState.expanded
    : defaultExpandedDimensions;

  const graph = useMemo(() => {
    if (!plan) {
      return { nodes: [] as Node<PlanNodeData>[], edges: [] as Edge[], minHeight: 520 };
    }

    return buildPlanGraph(plan, expandedDimensions, (name) => {
      setExpansionState((current) => {
        const source = current.planKey === planKey ? current.expanded : defaultExpandedDimensions;
        const next = new Set(source);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return {
          planKey,
          expanded: next,
        };
      });
    });
  }, [defaultExpandedDimensions, expandedDimensions, plan, planKey]);

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Execution plan</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">React Flow topology for Filter, Dispatch, Gates, Report, dimensions, and metrics</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary p-0.5">
            {(["fast", "normal", "deep"] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => {
                  onTierChange(tier);
                }}
                className={`rounded-full px-2.5 py-1 text-[10px] transition-colors ${
                  selectedTier === tier
                    ? "bg-desktop-accent text-desktop-accent-text"
                    : "text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!plan) {
                return;
              }
              setExpandedDimensions((current) => (
                current.size === plan.dimensions.length
                  ? new Set()
                  : new Set(plan.dimensions.map((dimension) => dimension.name))
              ));
            }}
            className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary"
          >
            {plan && expandedDimensions.size === plan.dimensions.length ? "Collapse metrics" : "Expand metrics"}
          </button>
          <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
            {repoLabel}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Building execution topology...
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}

      {plan ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">pass = admitted or scoring path</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">warn = threshold downgrade</span>
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">hard = blocking gate</span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-slate-700">blocked = report can stop on hard failure</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-desktop-border bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_28%)]">
            <div style={{ height: graph.minHeight }}>
              <ReactFlow
                fitView
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnScroll
                panOnDrag
                minZoom={0.5}
                maxZoom={1.4}
                fitViewOptions={{ padding: 0.12 }}
              >
                <Background color="#d7dee7" gap={20} size={1} />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
