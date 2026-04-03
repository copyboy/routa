import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        edit: "Edit",
        new: "New",
      },
      settings: {
        specialists: "Specialists",
      },
      errors: {
        loadFailed: "Load failed",
        saveFailed: "Save failed",
        deleteFailed: "Delete failed",
      },
    },
  }),
}));

import { SpecialistsTab } from "../settings-panel-specialists-tab";

describe("SpecialistsTab", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url === "/api/specialists") {
        return {
          ok: true,
          json: async () => ({
            specialists: [
              {
                id: "frontend-dev",
                name: "Frontend Dev",
                description: "Builds UI flows",
                role: "DEVELOPER",
                defaultModelTier: "BALANCED",
                systemPrompt: "Focus on compact UI delivery.",
                roleReminder: "Keep density high.",
                source: "user",
                model: "gpt-5.4",
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders the specialists page as a compact split-pane editor", async () => {
    render(<SpecialistsTab modelDefs={[{ alias: "gpt-5.4", modelName: "GPT-5.4" }]} />);

    await waitFor(() => {
      expect(screen.getByText("Frontend Dev")).not.toBeNull();
    });

    const root = screen.getByTestId("specialists-tab-root");
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("min-h-0");

    const catalogPanel = screen.getByTestId("specialists-tab-catalog");
    expect(catalogPanel.className).toContain("min-h-[320px]");
    expect(catalogPanel.className).toContain("overflow-hidden");

    const catalogList = screen.getByTestId("specialists-tab-catalog-list");
    expect(catalogList.className).toContain("flex-1");
    expect(catalogList.className).toContain("overflow-y-auto");

    const editorPanel = screen.getByTestId("specialists-tab-editor");
    expect(editorPanel.className).toContain("min-h-[480px]");
    expect(editorPanel.className).toContain("overflow-hidden");

    const specialistCard = screen.getByText("Frontend Dev").closest("button");
    expect(specialistCard).not.toBeNull();
    expect(specialistCard?.className).toContain("px-2.5");
    expect(specialistCard?.className).toContain("py-2");

    const promptField = screen.getByPlaceholderText("Define the specialist contract");
    expect(promptField.className).toContain("min-h-[240px]");
  });
});
