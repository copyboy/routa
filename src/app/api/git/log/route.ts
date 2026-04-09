/**
 * Next.js API route: GET /api/git/log
 *
 * Query params:
 *  - repoPath (required)
 *  - branches  (comma-separated, optional)
 *  - search    (optional)
 *  - limit     (default 40)
 *  - skip      (default 0)
 *
 * Returns GitLogPage JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepository,
  getCurrentBranch,
} from "@/core/git";
import { shellQuote } from "@/core/git/git-utils";
import { getServerBridge } from "@/core/platform";
import type { GitCommit, GitRef, GitLogPage } from "@/app/workspace/[workspaceId]/kanban/git-log/types";

export const dynamic = "force-dynamic";

function gitExec(command: string, cwd: string): string {
  const bridge = getServerBridge();
  return bridge.process.execSync(command, { cwd }).trimEnd();
}

function parseRefs(repoPath: string): GitRef[] {
  const refs: GitRef[] = [];
  const currentBranch = getCurrentBranch(repoPath);

  // Local branches
  try {
    const output = gitExec(
      `git for-each-ref --format='%(refname:short)%09%(objectname)' refs/heads/`,
      repoPath,
    );
    for (const line of output.split("\n").filter(Boolean)) {
      const [name, sha] = line.split("\t");
      if (name && sha) {
        refs.push({
          name,
          kind: "local",
          commitSha: sha,
          isCurrent: name === currentBranch,
        });
      }
    }
  } catch { /* empty repo */ }

  // Remote branches
  try {
    const output = gitExec(
      `git for-each-ref --format='%(refname:short)%09%(objectname)' refs/remotes/`,
      repoPath,
    );
    for (const line of output.split("\n").filter(Boolean)) {
      const [fullName, sha] = line.split("\t");
      if (!fullName || !sha || fullName.endsWith("/HEAD")) continue;
      const slashIdx = fullName.indexOf("/");
      const remote = slashIdx >= 0 ? fullName.slice(0, slashIdx) : "origin";
      const name = slashIdx >= 0 ? fullName.slice(slashIdx + 1) : fullName;
      refs.push({ name, kind: "remote", remote, commitSha: sha });
    }
  } catch { /* no remotes */ }

  // Tags
  try {
    const output = gitExec(
      `git for-each-ref --format='%(refname:short)%09%(*objectname)%09%(objectname)' refs/tags/`,
      repoPath,
    );
    for (const line of output.split("\n").filter(Boolean)) {
      const parts = line.split("\t");
      const name = parts[0];
      // For annotated tags, *objectname is the dereferenced commit; for lightweight tags it's empty
      const sha = (parts[1] || parts[2]) ?? "";
      if (name && sha) {
        refs.push({ name, kind: "tag", commitSha: sha });
      }
    }
  } catch { /* no tags */ }

  return refs;
}

function buildRefMap(refs: GitRef[]): Map<string, GitRef[]> {
  const map = new Map<string, GitRef[]>();
  for (const r of refs) {
    const list = map.get(r.commitSha) ?? [];
    list.push(r);
    map.set(r.commitSha, list);
  }
  return map;
}

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  if (!repoPath) {
    return NextResponse.json({ error: "repoPath is required" }, { status: 400 });
  }

  if (!isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Not a git repository" }, { status: 400 });
  }

  const branchesParam = request.nextUrl.searchParams.get("branches");
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 40, 200);
  const skip = Math.max(Number(request.nextUrl.searchParams.get("skip")) || 0, 0);

  try {
    const refs = parseRefs(repoPath);
    const refMap = buildRefMap(refs);

    // Build git log command
    const parts = [
      "git",
      "--no-pager",
      "log",
      `--format=%H%x1f%h%x1f%s%x1f%B%x1e%an%x1f%ae%x1f%aI%x1f%P`,
      `--max-count=${limit + 1}`,  // +1 to detect hasMore
      `--skip=${skip}`,
    ];

    // Branch filter
    if (branchesParam) {
      const branches = branchesParam.split(",").map((b) => b.trim()).filter(Boolean);
      for (const b of branches) {
        parts.push(shellQuote(b));
      }
    } else {
      parts.push("--all");
    }

    // Search filter
    if (search) {
      // Check if it looks like a SHA
      if (/^[0-9a-f]{4,40}$/i.test(search)) {
        // For SHA search, we need a different approach
        parts.push(`--grep=${shellQuote(search)}`);
      } else {
        parts.push(`--grep=${shellQuote(search)}`, "--regexp-ignore-case");
      }
    }

    const output = (() => {
      try {
        return gitExec(parts.join(" "), repoPath);
      } catch {
        return "";
      }
    })();

    const commits: GitCommit[] = [];
    const lines = output.split("\n").filter(Boolean);

    for (const line of lines) {
      // Format: SHA\x1fshortSHA\x1fsummary\x1ffullMessage\x1eauthorName\x1fauthorEmail\x1fauthoredAt\x1fparents
      const mainParts = line.split("\u001e");
      const firstHalf = (mainParts[0] ?? "").split("\u001f");
      const secondHalf = (mainParts[1] ?? "").split("\u001f");

      const sha = firstHalf[0];
      const shortSha = firstHalf[1];
      const summary = firstHalf[2];
      const message = firstHalf[3] ?? summary;
      const authorName = secondHalf[0];
      const authorEmail = secondHalf[1];
      const authoredAt = secondHalf[2];
      const parentStr = secondHalf[3] ?? "";

      if (!sha || !shortSha || !summary || !authorName || !authoredAt) continue;

      const parents = parentStr.split(" ").filter(Boolean);

      commits.push({
        sha,
        shortSha,
        message: message ?? summary,
        summary,
        authorName,
        authorEmail: authorEmail ?? "",
        authoredAt,
        parents,
        refs: refMap.get(sha) ?? [],
        lane: parents.length > 1 ? 1 : 0,  // Simplified lane assignment
        graphEdges: parents.length > 1
          ? [{ fromLane: 1, toLane: 0, isMerge: true }, { fromLane: 1, toLane: 1 }]
          : [{ fromLane: 0, toLane: 0 }],
      });
    }

    const hasMore = commits.length > limit;
    if (hasMore) commits.pop();

    // Count total commits (approximate for performance)
    let total = skip + commits.length + (hasMore ? 1 : 0);
    if (skip === 0 && !hasMore) {
      total = commits.length;
    } else {
      try {
        const countCmd = branchesParam
          ? `git rev-list --count ${branchesParam.split(",").map(b => shellQuote(b.trim())).join(" ")}`
          : "git rev-list --count --all";
        const countStr = gitExec(countCmd, repoPath);
        total = Number.parseInt(countStr, 10) || total;
      } catch { /* use approximate */ }
    }

    const page: GitLogPage = { commits, total, hasMore };
    return NextResponse.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
