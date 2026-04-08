import { describe, expect, it, vi } from "vitest";

import { AcpProcess } from "../acp-process";

describe("AcpProcess codex permission handling", () => {
  function createProcess(onNotification = vi.fn()) {
    return new AcpProcess({
      command: "codex-acp",
      args: [],
      cwd: "/tmp",
      displayName: "Codex",
    }, onNotification);
  }

  it("auto-approves codex permission requests even without explicit session auto-approval", () => {
    const onNotification = vi.fn();
    const process = createProcess(onNotification);
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 7,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          status: "completed",
          kind: "request-permissions",
        }),
      }),
    }));
  });

  it("selects the approved option for codex option-based permission requests", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved", kind: "allow_once" },
          { optionId: "abort", kind: "reject_once" },
        ],
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 9,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
  });

  it("maps manual codex permission responses to option selections", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).pendingInteractiveRequests.set("request-permission-1", {
      requestId: 10,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved", kind: "allow_once" },
          { optionId: "abort", kind: "reject_once" },
        ],
      },
    });

    const handled = process.respondToUserInput("request-permission-1", {
      decision: "approve",
      scope: "session",
    });

    expect(handled).toBe(true);
    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 10,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved-for-session",
        },
      },
    });
  });

  it("passes through explicit option ids for option-driven permission requests", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).pendingInteractiveRequests.set("request-permission-2", {
      requestId: 12,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved", kind: "allow_once" },
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved-always", kind: "allow_always" },
          { optionId: "cancel", kind: "reject_once" },
        ],
      },
    });

    const handled = process.respondToUserInput("request-permission-2", {
      optionId: "approved-always",
      decision: "approve",
      scope: "session",
    });

    expect(handled).toBe(true);
    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 12,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved-always",
        },
      },
    });
  });

  it("falls back to ACP-standard selected results when options are missing", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 11,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
  });

  it("keeps non-codex permission requests interactive unless auto-approval is enabled", () => {
    const onNotification = vi.fn();
    const process = new AcpProcess({
      command: "opencode",
      args: [],
      cwd: "/tmp",
      displayName: "OpenCode",
    }, onNotification);
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-2",
      provider: "opencode",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).not.toHaveBeenCalled();
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          status: "waiting",
          kind: "request-permissions",
        }),
      }),
    }));
  });
});
