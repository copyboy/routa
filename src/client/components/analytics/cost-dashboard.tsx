"use client";

/**
 * CostDashboard — Displays cost analytics for agent traces.
 */

import { useEffect, useState } from "react";

interface ModelCostData {
  model: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  requestCount: number;
}

interface SessionCostData {
  sessionId: string;
  cost: number;
}

interface CostData {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costByModel: ModelCostData[];
  costBySession: SessionCostData[];
}

interface CostDashboardProps {
  sessionId?: string;
  workspaceId?: string;
}

export function CostDashboard({ sessionId, workspaceId }: CostDashboardProps) {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (sessionId) params.set("sessionId", sessionId);
      if (workspaceId) params.set("workspaceId", workspaceId);

      try {
        const res = await fetch(`/api/analytics?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch analytics");
        const analytics = await res.json();
        setData(analytics.cost);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId, workspaceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">No cost data available</p>
      </div>
    );
  }

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(cost);
  };

  const formatTokens = (tokens: number) => {
    return new Intl.NumberFormat("en-US").format(tokens);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Total Cost</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCost(data.totalCost)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Input Tokens</h3>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatTokens(data.totalInputTokens)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Output Tokens</h3>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatTokens(data.totalOutputTokens)}</p>
        </div>
      </div>

      {/* Cost by Model */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cost by Model</h2>
        </div>
        <div className="p-4">
          {data.costByModel.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No model cost data available</p>
          ) : (
            <div className="space-y-3">
              {data.costByModel.map((model) => (
                <div key={model.model} className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{model.model}</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCost(model.totalCost)}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${(model.totalCost / data.totalCost) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>Input: {formatCost(model.inputCost)}</span>
                      <span>Output: {formatCost(model.outputCost)}</span>
                      <span>{model.requestCount} requests</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cost by Session */}
      {data.costBySession.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cost by Session</h2>
          </div>
          <div className="p-4">
            <div className="space-y-2">
              {data.costBySession
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 10)
                .map((session) => (
                  <div key={session.sessionId} className="flex items-center justify-between py-2">
                    <code className="text-xs text-gray-600 dark:text-gray-400">{session.sessionId.slice(0, 16)}...</code>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatCost(session.cost)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
