/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerDetector } from "../detector";

const execMock = vi.fn();

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      exec: execMock,
    },
  }),
}));

describe("DockerDetector", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("returns available status when docker info succeeds", async () => {
    execMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ ServerVersion: "27.3.1", ClientInfo: { ApiVersion: "1.47" } }),
      stderr: "",
    });

    const detector = new DockerDetector();
    const result = await detector.checkAvailability(true);

    expect(result.available).toBe(true);
    expect(result.daemonRunning).toBe(true);
    expect(result.version).toBe("27.3.1");
    expect(result.apiVersion).toBe("1.47");
  });

  it("returns unavailable status when docker command fails", async () => {
    execMock.mockRejectedValueOnce(new Error("docker: command not found"));

    const detector = new DockerDetector();
    const result = await detector.checkAvailability(true);

    expect(result.available).toBe(false);
    expect(result.daemonRunning).toBe(false);
    expect(result.error).toContain("docker: command not found");
  });

  it("uses cached availability result within ttl", async () => {
    execMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ ServerVersion: "27.3.1", ClientInfo: { ApiVersion: "1.47" } }),
      stderr: "",
    });

    const detector = new DockerDetector();
    const first = await detector.checkAvailability(false);
    const second = await detector.checkAvailability(false);

    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("forces refresh when forceRefresh=true", async () => {
    execMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ServerVersion: "27.3.1", ClientInfo: { ApiVersion: "1.47" } }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ServerVersion: "27.4.0", ClientInfo: { ApiVersion: "1.48" } }),
        stderr: "",
      });

    const detector = new DockerDetector();
    const first = await detector.checkAvailability(false);
    const second = await detector.checkAvailability(true);

    expect(first.version).toBe("27.3.1");
    expect(second.version).toBe("27.4.0");
    expect(execMock).toHaveBeenCalledTimes(2);
  });
});
