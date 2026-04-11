#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { fromRoot } from "../lib/paths";
import { quietNodeEnv, sanitizedNodeEnv } from "../lib/node-env";

function main(): void {
  const vitestResult = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
    ],
    {
      cwd: fromRoot(),
      env: quietNodeEnv(),
      stdio: "inherit",
    },
  );

  if (vitestResult.status !== 0) {
    process.exit(vitestResult.status ?? 1);
  }

  const aggregateResult = spawnSync(
    process.execPath,
    ["--import", "tsx", fromRoot("scripts", "fitness", "write-coverage-summary.ts")],
    {
      cwd: fromRoot(),
      env: sanitizedNodeEnv(),
      stdio: "inherit",
    },
  );

  if (aggregateResult.status !== 0) {
    process.exit(aggregateResult.status ?? 1);
  }
}

main();
