# Routa.js Architecture


Routa orchestrates AI agents to collaborate on complex development tasks through specialized roles and real-time coordination. The system parses natural language into structured intent (Spec with Tasks), then shares this unified intent across all downstream agents.

### Core Principles

- **Multi-Protocol**: MCP (Model Context Protocol), ACP (Agent Client Protocol), A2A (Agent-to-Agent Protocol)
- **Workspace-First**: Every agent, task, note, and session belongs to a workspace
- **Real-Time Coordination**: SSE streams, WebSocket support, event-driven architecture
- **Dual-Backend**: Identical REST APIs on both Next.js (web) and Rust (desktop)
- **Pluggable Storage**: In-Memory, SQLite (local), or Postgres (cloud)

## Dual-Backend

| | Next.js (`src/`) | Rust (`crates/routa-server/`) |
|---|---|---|
| 用途 | Web (Vercel) | Desktop (Tauri) |
| 数据库 | Postgres (Drizzle ORM) | SQLite |
| 特点 | Stateless, serverless | Stateful, local-first |
| 实时 | SSE | SSE + WebSocket |

两端实现相同 OpenAPI 合约 (`api-contract.yaml`)，通过 `npm run api:check` 验证一致性。

## Layer Architecture

```
Presentation  →  React Components, Chat UI, Task Panel, Trace Viewer
     ↓
API Layer     →  Next.js Routes / Axum Handlers
     ↓
Protocol      →  MCP, ACP, A2A (JSON-RPC)
     ↓
Core Logic    →  RoutaSystem, Tools, Orchestration
     ↓
Store         →  AgentStore, TaskStore, NoteStore, etc.
     ↓
Database      →  Postgres / SQLite / In-Memory
```

层间单向依赖，下层不依赖上层。


## Data Flow

```
User Input → Chat Panel → /api/acp → Agent Process (stdio)
  → MCP Tools → Store + EventBus → UI Update (SSE)
  → SessionWriteBuffer → DB/JSONL
```

## Domain Concepts

| 概念                   | 说明                                                        | API |
|----------------------|-----------------------------------------------------------|---|
| **Workspace**        | 逻辑容器，所有实体的作用域                                             | `/api/workspaces` |
| **Agent**            | AI 实体，角色: ROUTA / CRAFTER / GATE / DEVELOPER / Custom     | `/api/agents` |
| Agent Provider (CLI) | Coding Agent 提供商， 如 OpenCode, Codex 等实现 ACP 协议            | `/api/providers` |
| Agent Provider (SDK) | Coding Agent 提供商，如 Claude Code SDK, OpenCode SDK 等实现自定义协议 | `/api/providers` |
| **Task**             | 工作单元，支持依赖 (DAG)、验收标准、状态机                                  | `/api/tasks` |
| **Note**             | 协作文档，CRDT (Yjs) 实时同步                                      | `/api/notes` |
| **Session**          | ACP 会话，代表一个 Agent 进程                                      | `/api/sessions`, `/api/acp` |
| **Specialist**       | 自定义角色模板 (system prompt + model tier)                      | `/api/specialists` |
| **Skill**            | 可复用能力，从 repo 发现加载                                         | `/api/skills` |
| **Trace**            | Agent 行为录制 (JSONL)，用于回放和调试                                | `/api/traces` |

### Agent Roles

- **ROUTA**: 协调者 — 规划、创建任务、委派
- **CRAFTER**: 执行者 — 实现任务、写代码
- **GATE**: 审核者 — Review、Approve/Reject
- **DEVELOPER**: 独立模式 — 规划 + 实现，不委派

### Task Status Flow

`PENDING → IN_PROGRESS → REVIEW_REQUIRED → COMPLETED` (或 NEEDS_FIX / BLOCKED / CANCELLED)

## Key Patterns

### RoutaSystem Factory

中央工厂，创建所有 Store 和 Tools。Driver 选择优先级：
1. `DATABASE_URL` → Postgres
2. `ROUTA_DB_DRIVER=sqlite` → SQLite
3. 默认 → In-Memory

### SessionWriteBuffer

批量写入 + 防抖，应对每秒数百个 `agent_message_chunk` 事件：
- 50 条/批次，5 秒防抖
- 合并消息分片后持久化到 Postgres 或 JSONL

### Session History Storage

- Local: `~/.routa/projects/{folder-slug}/sessions/{uuid}.jsonl`
- Remote: Postgres `acp_sessions` 表

## ACP Provider Architecture

Routa 通过 Provider Adapter 模式统一处理不同 AI Agent CLI 的消息格式差异。

### Provider Adapter Pattern

每个 Provider 实现 `IProviderAdapter` 接口，将原始通知归一化为 `NormalizedSessionUpdate`：

```
Raw Notification (各 Provider 格式不同)
  → IProviderAdapter.normalize()
  → NormalizedSessionUpdate (统一格式)
  → SessionWriteBuffer → DB/JSONL
```

| Adapter | Provider | 特点 |
|---|---|---|
| `ClaudeCodeAdapter` | Claude Code | stream-json 协议，tool input 立即可用 |
| `OpenCodeAdapter` | OpenCode | 标准 ACP，deferred rawInput |
| `DockerOpenCodeProviderAdapter` | Docker OpenCode | HTTP bridge 容器模式 |
| `StandardAcpAdapter` | Gemini / Copilot / Codex / Auggie / Kiro / Kimi | 通用标准 ACP |
| `WorkspaceAgentProviderAdapter` | Workspace Agent | Vercel AI SDK native |

### Provider Registry

`ProviderRegistry` 管理 Provider 的创建和能力查询：
- 按 `providerId` + `modelTier` 解析模型
- 支持 capability-based 路由 (`findBestProviderForRole`)
- Specialist 可绑定特定 Provider

### ACP Presets & Registry

- 内置 Presets: 预定义的 Agent CLI 配置 (command, args, env)
- ACP Registry: 远程注册表，动态发现可用 Agent
- Custom Providers: 用户自定义 ACP CLI (localStorage 存储)

## Protocol Stack

| 协议 | 端点 | 用途 |
|---|---|---|
| **MCP** | `/api/mcp` | Agent 协作工具 (delegate, message, note) |
| **ACP** | `/api/acp` | 管理 Agent 进程 (initialize, prompt, cancel) |
| **A2A** | `/api/a2a` | 跨平台 Agent 联邦 |
| **REST** | `/api/*` | CRUD (合约见 `api-contract.yaml`) |

## References

- API Contract: `api-contract.yaml`
- Coding Standards: `AGENTS.md`
- [MCP Spec](https://modelcontextprotocol.io/) · [ACP Spec](https://github.com/agentclientprotocol/sdk) · [A2A Spec](https://a2a-js.github.io/sdk/)
