/**
 * GET /api/analytics — Get analytics data for traces.
 *
 * Query parameters:
 * - sessionId: Filter by session ID
 * - workspaceId: Filter by workspace ID
 * - startDate: Start date (YYYY-MM-DD)
 * - endDate: End date (YYYY-MM-DD)
 */

import { NextRequest, NextResponse } from "next/server";
import { getTraceReader, type TraceQuery } from "@/core/trace";

export const dynamic = "force-dynamic";

interface AnalyticsQueryParams {
  sessionId?: string;
  workspaceId?: string;
  startDate?: string;
  endDate?: string;
}

function parseQueryParams(requestUrl: string): AnalyticsQueryParams {
  const url = new URL(requestUrl);
  return {
    sessionId: url.searchParams.get("sessionId") ?? undefined,
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
  };
}

function toTraceQuery(params: AnalyticsQueryParams): TraceQuery {
  return {
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    startDate: params.startDate,
    endDate: params.endDate,
  };
}

interface ModelPricing {
  inputPricePer1k: number;
  outputPricePer1k: number;
}

// Approximate pricing data (in USD per 1K tokens)
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4": { inputPricePer1k: 0.015, outputPricePer1k: 0.075 },
  "claude-sonnet-4": { inputPricePer1k: 0.003, outputPricePer1k: 0.015 },
  "claude-haiku-4": { inputPricePer1k: 0.0008, outputPricePer1k: 0.004 },
  "gpt-4": { inputPricePer1k: 0.03, outputPricePer1k: 0.06 },
  "gpt-4-turbo": { inputPricePer1k: 0.01, outputPricePer1k: 0.03 },
  "gpt-3.5-turbo": { inputPricePer1k: 0.0005, outputPricePer1k: 0.0015 },
};

function getModelPricing(model?: string): ModelPricing {
  if (!model) return { inputPricePer1k: 0.001, outputPricePer1k: 0.002 };

  // Try exact match first
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // Try partial match
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key)) return pricing;
  }

  // Default pricing
  return { inputPricePer1k: 0.001, outputPricePer1k: 0.002 };
}

/**
 * GET /api/analytics — Get analytics data including cost, reliability, and performance metrics.
 */
export async function GET(request: NextRequest) {
  try {
    const params = parseQueryParams(request.url);
    const query = toTraceQuery(params);

    const cwd = process.cwd();
    const reader = getTraceReader(cwd);

    const traces = await reader.query(query);

    // Calculate cost metrics
    const costByModel: Record<string, { inputCost: number; outputCost: number; totalCost: number; requestCount: number }> = {};
    const costBySession: Record<string, number> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    // Calculate reliability metrics
    const toolCalls: Array<{ name: string; status?: string; success: boolean }> = [];
    const errorsByType: Record<string, number> = {};

    // Calculate performance metrics
    const eventTimestamps: Array<{ timestamp: string; eventType: string }> = [];
    const toolLatencies: Array<{ tool: string; duration: number }> = [];

    for (const trace of traces) {
      // Cost metrics from metadata (if available)
      const inputTokens = (trace.metadata?.inputTokens as number) || 0;
      const outputTokens = (trace.metadata?.outputTokens as number) || 0;

      if (inputTokens > 0 || outputTokens > 0) {
        const model = trace.contributor.model || "unknown";
        const pricing = getModelPricing(model);
        const inputCost = (inputTokens / 1000) * pricing.inputPricePer1k;
        const outputCost = (outputTokens / 1000) * pricing.outputPricePer1k;
        const traceCost = inputCost + outputCost;

        if (!costByModel[model]) {
          costByModel[model] = { inputCost: 0, outputCost: 0, totalCost: 0, requestCount: 0 };
        }
        costByModel[model].inputCost += inputCost;
        costByModel[model].outputCost += outputCost;
        costByModel[model].totalCost += traceCost;
        costByModel[model].requestCount++;

        costBySession[trace.sessionId] = (costBySession[trace.sessionId] || 0) + traceCost;

        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCost += traceCost;
      }

      // Reliability metrics
      if (trace.eventType === "tool_call" || trace.eventType === "tool_result") {
        const toolName = trace.tool?.name || "unknown";
        const status = trace.tool?.status || "unknown";
        const success = status === "completed" || status === "running";

        toolCalls.push({ name: toolName, status, success });

        if (!success && status !== "running") {
          errorsByType[status] = (errorsByType[status] || 0) + 1;
        }
      }

      // Performance metrics
      eventTimestamps.push({ timestamp: trace.timestamp, eventType: trace.eventType });
    }

    // Calculate latency from consecutive events
    for (let i = 1; i < eventTimestamps.length; i++) {
      const prev = eventTimestamps[i - 1];
      const curr = eventTimestamps[i];
      const duration = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();

      if (curr.eventType === "tool_result" && prev.eventType === "tool_call") {
        // Extract tool name from current event
        const matchingTrace = traces.find(t => t.timestamp === curr.timestamp);
        if (matchingTrace?.tool?.name) {
          toolLatencies.push({ tool: matchingTrace.tool.name, duration });
        }
      }
    }

    // Calculate averages
    const avgToolLatency = toolLatencies.length > 0
      ? toolLatencies.reduce((sum, t) => sum + t.duration, 0) / toolLatencies.length
      : 0;

    const avgLatencyByTool: Record<string, { avg: number; count: number; max: number }> = {};
    for (const { tool, duration } of toolLatencies) {
      if (!avgLatencyByTool[tool]) {
        avgLatencyByTool[tool] = { avg: 0, count: 0, max: 0 };
      }
      avgLatencyByTool[tool].count++;
      avgLatencyByTool[tool].avg += duration;
      avgLatencyByTool[tool].max = Math.max(avgLatencyByTool[tool].max, duration);
    }
    for (const tool of Object.keys(avgLatencyByTool)) {
      avgLatencyByTool[tool].avg = avgLatencyByTool[tool].avg / avgLatencyByTool[tool].count;
    }

    // Calculate reliability
    const successfulToolCalls = toolCalls.filter(t => t.success).length;
    const totalToolCalls = toolCalls.length;
    const successRate = totalToolCalls > 0 ? (successfulToolCalls / totalToolCalls) * 100 : 0;

    return NextResponse.json({
      cost: {
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        costByModel: Object.entries(costByModel).map(([model, data]) => ({
          model,
          ...data,
        })),
        costBySession: Object.entries(costBySession).map(([sessionId, cost]) => ({
          sessionId,
          cost,
        })),
      },
      reliability: {
        successRate,
        totalToolCalls,
        successfulToolCalls,
        failedToolCalls: totalToolCalls - successfulToolCalls,
        errorsByType,
        topErrors: Object.entries(errorsByType)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([error, count]) => ({ error, count })),
      },
      performance: {
        avgToolLatency,
        totalEvents: traces.length,
        toolLatencies: avgLatencyByTool,
        eventCounts: {
          userMessages: traces.filter(t => t.eventType === "user_message").length,
          agentMessages: traces.filter(t => t.eventType === "agent_message").length,
          toolCalls: traces.filter(t => t.eventType === "tool_call").length,
          toolResults: traces.filter(t => t.eventType === "tool_result").length,
        },
      },
    });
  } catch (error) {
    console.error("[Analytics API] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to get analytics data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
