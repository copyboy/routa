import type { RepoTreeNode } from "./scan-codebase-tree";

const ROOT_FILE_ANCHORS = [
  "README.md",
  "README",
  "AGENTS.md",
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "docs/ARCHITECTURE.md",
  "docs/adr/README.md",
];

const DIRECTORY_ANCHORS = ["src/app", "src/core", "src/client", "crates", "docs", "apps", "api"];

export interface RepoWikiAnchor {
  kind: "file" | "directory";
  path: string;
  reason: string;
}

export function extractArchitectureAnchors(tree: RepoTreeNode): RepoWikiAnchor[] {
  const anchors: RepoWikiAnchor[] = [];
  const rootChildren = tree.children ?? [];

  for (const child of rootChildren) {
    if (child.type !== "file") continue;
    if (ROOT_FILE_ANCHORS.some((name) => child.name === name || child.name.startsWith(name.split(".")[0]))) {
      anchors.push({
        kind: "file",
        path: child.path,
        reason: `Architecture/documentation anchor (${child.name})`,
      });
    }
  }

  for (const dirPath of DIRECTORY_ANCHORS) {
    const node = findNodeByPath(tree, dirPath);
    if (!node) continue;
    anchors.push({
      kind: "directory",
      path: node.path,
      reason: "Architecture anchor directory",
    });
  }

  return anchors;
}

function findNodeByPath(tree: RepoTreeNode, targetPath: string): RepoTreeNode | null {
  const segments = targetPath.split("/");
  let current: RepoTreeNode | undefined = tree;

  for (const segment of segments) {
    if (!current?.children) return null;
    current = current.children.find((child) => child.name === segment);
    if (!current) return null;
  }

  return current;
}
