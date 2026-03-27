export type KanbanFileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "typechange"
  | "conflicted";

export interface KanbanRepoStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

export interface KanbanFileChangeItem {
  path: string;
  status: KanbanFileChangeStatus;
  previousPath?: string;
}

export interface KanbanRepoChanges {
  codebaseId: string;
  repoPath: string;
  label: string;
  branch: string;
  status: KanbanRepoStatus;
  files: KanbanFileChangeItem[];
  error?: string;
}
