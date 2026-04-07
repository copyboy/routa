import { describe, expect, it } from "vitest";
import { parseGitStatusPorcelain } from "../git-utils";

describe("parseGitStatusPorcelain", () => {
  it("preserves the first character of filenames in porcelain rows", () => {
    expect(parseGitStatusPorcelain(" M package-lock.json")).toEqual([
      { path: "package-lock.json", status: "modified" },
    ]);
  });

  it("parses untracked files without rewriting their path", () => {
    expect(parseGitStatusPorcelain("?? package-lock.json")).toEqual([
      { path: "package-lock.json", status: "untracked" },
    ]);
  });
});
