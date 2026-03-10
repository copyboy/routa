import { describe, it, expect } from "vitest";
import { HistoryCompactor } from "../history-compactor";

describe("HistoryCompactor", () => {
  it("should be constructable with a database instance", () => {
    const mockDb = {} as any;
    const compactor = new HistoryCompactor(mockDb);
    expect(compactor).toBeInstanceOf(HistoryCompactor);
  });

  it("should expose a compact method", () => {
    const mockDb = {} as any;
    const compactor = new HistoryCompactor(mockDb);
    expect(typeof compactor.compact).toBe("function");
  });
});
