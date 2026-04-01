"use client";

type MaybeMessage = string | null | undefined;

type HarnessUnsupportedStateProps = {
  className?: string;
};

const UNSUPPORTED_REPO_MARKERS = [
  "不存在或不是目录",
] as const;

export function getHarnessUnsupportedRepoMessage(...messages: MaybeMessage[]): string | null {
  const matched = messages.find((message) => (
    typeof message === "string"
    && UNSUPPORTED_REPO_MARKERS.some((marker) => message.includes(marker))
  ));

  if (!matched) {
    return null;
  }

  return "当前仓库路径无效或不可访问，当前页面无法渲染该视图。";
}

export function HarnessUnsupportedState({
  className,
}: HarnessUnsupportedStateProps) {
  return (
    <div className={className ?? "mt-4 flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-4 shadow-sm dark:border-amber-700 dark:bg-amber-950/30"}>
      <svg className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-100">
          仓库不支持 Harness
        </div>
        <div className="mt-1 text-[12px] leading-5 text-amber-800 dark:text-amber-200">
          当前仓库路径无效或不可访问，无法渲染该视图。
        </div>
      </div>
    </div>
  );
}
