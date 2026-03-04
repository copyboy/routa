"use client";

/**
 * ReliabilityMetrics — Displays reliability analytics for agent traces.
 */

import { useEffect, useState } from "react";

interface ErrorData {
  error: string;
  count: number;
}

interface ReliabilityData {
  successRate: number;
  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  errorsByType: Record<string, number>;
  topErrors: ErrorData[];
}

interface ReliabilityMetricsProps {
  sessionId?: string;
  workspaceId?: string;
}

export function ReliabilityMetrics({ sessionId, workspaceId }: ReliabilityMetricsProps) {
  const [data, setData] = useState<ReliabilityData | null>(null);
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
        setData(analytics.reliability);
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
        <p className="text-gray-500">No reliability data available</p>
      </div>
    );
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return "text-green-600 dark:text-green-400";
    if (rate >= 80) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getSuccessRateBgColor = (rate: number) => {
    if (rate >= 95) return "bg-green-500";
    if (rate >= 80) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="p-6 space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Success Rate</h3>
          <p className={`text-2xl font-bold ${getSuccessRateColor(data.successRate)}`}>
            {data.successRate.toFixed(1)}%
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Total Tool Calls</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.totalToolCalls}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Successful</h3>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{data.successfulToolCalls}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Failed</h3>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{data.failedToolCalls}</p>
        </div>
      </div>

      {/* Success Rate Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Tool Call Success Rate</h3>
          <span className={`text-sm font-semibold ${getSuccessRateColor(data.successRate)}`}>
            {data.successRate.toFixed(1)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full ${getSuccessRateBgColor(data.successRate)}`}
            style={{ width: `${data.successRate}%` }}
          />
        </div>
      </div>

      {/* Top Errors */}
      {data.topErrors.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Top Error Types</h2>
          </div>
          <div className="p-4">
            <div className="space-y-3">
              {data.topErrors.map((error) => (
                <div key={error.error} className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{error.error}</span>
                      <span className="text-sm font-semibold text-red-600 dark:text-red-400">{error.count}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
                        style={{ width: `${(error.count / data.totalToolCalls) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* All Errors by Type */}
      {Object.keys(data.errorsByType).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Error Breakdown</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(data.errorsByType).map(([errorType, count]) => (
                <div
                  key={errorType}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700"
                >
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate mr-2">{errorType}</span>
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* No Errors State */}
      {data.failedToolCalls === 0 && data.totalToolCalls > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 p-6 text-center">
          <svg
            className="w-12 h-12 text-green-500 mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-green-800 dark:text-green-200">Perfect Reliability!</p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            All {data.totalToolCalls} tool calls completed successfully
          </p>
        </div>
      )}

      {/* No Data State */}
      {data.totalToolCalls === 0 && (
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
          <svg
            className="w-12 h-12 text-gray-400 mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No Tool Calls Yet</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Tool call data will appear here once agents start using tools
          </p>
        </div>
      )}
    </div>
  );
}
