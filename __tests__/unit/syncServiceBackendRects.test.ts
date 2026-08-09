// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const { updatePinRects } = vi.hoisted(() => ({
  updatePinRects: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  api: { updatePinRects },
}));

vi.mock("../../src/store/graphStore", () => ({
  graphStore: { units: [] },
}));

import { syncService } from "../../src/services/syncService";
import { addOrUpdateRect, removeRect } from "../../src/services/uiRegistry";

describe("syncService backend hit rectangles", () => {
  afterEach(() => {
    removeRect("test-actions-menu");
    updatePinRects.mockReset();
  });

  it("serializes updates and sends the latest rectangle after an in-flight update", async () => {
    let resolveFirst: (() => void) | undefined;
    updatePinRects
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue(undefined);

    addOrUpdateRect({
      id: "test-actions-menu",
      x: 10,
      y: 20,
      width: 250,
      height: 300,
      name: "ACTIONS_MENU",
    });
    const first = syncService.updateBackendRects();
    await vi.waitFor(() => expect(updatePinRects).toHaveBeenCalledTimes(1));

    addOrUpdateRect({
      id: "test-actions-menu",
      x: 80,
      y: 90,
      width: 250,
      height: 300,
      name: "ACTIONS_MENU",
    });
    const second = syncService.updateBackendRects();
    resolveFirst?.();
    await Promise.all([first, second]);

    expect(updatePinRects).toHaveBeenCalledTimes(2);
    const latestRects = updatePinRects.mock.calls[1][0] as Array<{ x: number; y: number; name: string }>;
    expect(latestRects).toContainEqual(expect.objectContaining({
      x: 80,
      y: 90,
      name: "ACTIONS_MENU",
    }));
  });
});
