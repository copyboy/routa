import { getServerBridge } from "@/core/platform";
import type { DockerPullResult, DockerStatus } from "./types";

const CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export class DockerDetector {
  private static instance: DockerDetector | null = null;
  private cachedStatus: DockerStatus | null = null;
  private cachedAt = 0;

  static getInstance(): DockerDetector {
    if (!DockerDetector.instance) {
      DockerDetector.instance = new DockerDetector();
    }
    return DockerDetector.instance;
  }

  async checkAvailability(forceRefresh = false): Promise<DockerStatus> {
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedStatus;
    }

    const bridge = getServerBridge();
    const checkedAt = new Date().toISOString();

    try {
      const { stdout } = await bridge.process.exec("docker info --format '{{json .}}'", {
        timeout: DEFAULT_TIMEOUT_MS,
      });

      const parsed = this.parseDockerInfo(stdout);
      const status: DockerStatus = {
        available: true,
        daemonRunning: true,
        version: parsed.version,
        apiVersion: parsed.apiVersion,
        checkedAt,
      };

      this.cachedStatus = status;
      this.cachedAt = now;
      return status;
    } catch (err) {
      const status: DockerStatus = {
        available: false,
        daemonRunning: false,
        error: err instanceof Error ? err.message : "Docker unavailable",
        checkedAt,
      };

      this.cachedStatus = status;
      this.cachedAt = now;
      return status;
    }
  }

  async isImageAvailable(image: string): Promise<boolean> {
    const bridge = getServerBridge();

    try {
      const { stdout } = await bridge.process.exec(`docker images -q ${image}`, {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async pullImage(image: string): Promise<DockerPullResult> {
    const bridge = getServerBridge();

    try {
      const { stdout, stderr } = await bridge.process.exec(`docker pull ${image}`, {
        timeout: 10 * 60_000,
      });

      return {
        ok: true,
        image,
        output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim(),
      };
    } catch (err) {
      return {
        ok: false,
        image,
        error: err instanceof Error ? err.message : "Failed to pull image",
      };
    }
  }

  private parseDockerInfo(stdout: string): { version?: string; apiVersion?: string } {
    try {
      const json = JSON.parse(stdout.trim()) as Record<string, unknown>;
      const serverVersion = typeof json.ServerVersion === "string" ? json.ServerVersion : undefined;
      const clientInfo = (json.ClientInfo ?? {}) as Record<string, unknown>;
      const apiVersion = typeof clientInfo.ApiVersion === "string"
        ? clientInfo.ApiVersion
        : (typeof json.APIVersion === "string" ? json.APIVersion : undefined);

      return {
        version: serverVersion,
        apiVersion,
      };
    } catch {
      return {};
    }
  }
}

export function getDockerDetector(): DockerDetector {
  return DockerDetector.getInstance();
}
