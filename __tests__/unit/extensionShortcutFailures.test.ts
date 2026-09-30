import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtensionShortcutRegistry } from "../../src/services/extensionShortcutRegistry";
import { translationSnapshot, toggleCommand, translator } from "../fixtures/translation";

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    show: vi.fn(),
    target: vi.fn(),
}));

vi.mock("../../src/services/extensionCommandRouter", () => ({
    extensionCommandRouter: { execute: mocks.execute },
}));
vi.mock("../../src/services/extensionNoticeRegistry", () => ({
    extensionNoticeRegistry: { show: mocks.show },
}));
vi.mock("../../src/services/extensionContext", () => ({
    currentExtensionTarget: mocks.target,
    currentExtensionWhenContext: () => ({
        unit: { kind: "sticker", hasImage: true },
        attachmentTypes: new Set<string>(),
    }),
}));

const dispatch = (registry: ExtensionShortcutRegistry) => {
    registry.handleKeyDown(new KeyboardEvent("keydown", {
        key: "5", code: "Digit5", ctrlKey: true, cancelable: true,
    }));
};

describe("extension shortcut failure notices", () => {
    beforeEach(() => {
        mocks.execute.mockReset();
        mocks.show.mockReset();
        mocks.target.mockReturnValue({ unitId: "original-unit", revision: 4 });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it("reports a failed command on its original unit after selection changes", async () => {
        const registry = new ExtensionShortcutRegistry();
        registry.applySnapshot(translationSnapshot());
        mocks.execute.mockRejectedValueOnce(new Error("extension runtime request failed"));
        dispatch(registry);
        mocks.target.mockReturnValue({ unitId: "other-unit", revision: 1 });

        await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
        expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(toggleCommand);
        expect(mocks.show).toHaveBeenCalledWith(`${translator}-scope`, "original-unit", {
            title: expect.any(String), message: "extension runtime request failed",
        });
    });

    it("does not recreate a notice after the owning extension disconnects", async () => {
        const registry = new ExtensionShortcutRegistry();
        registry.applySnapshot(translationSnapshot());
        mocks.execute.mockRejectedValueOnce(new Error("extension bridge disconnected"));
        dispatch(registry);
        registry.applySnapshot(null);
        await Promise.resolve();
        expect(mocks.show).not.toHaveBeenCalled();
    });

    it("does not show a failure notice for a successful command", async () => {
        const registry = new ExtensionShortcutRegistry();
        registry.applySnapshot(translationSnapshot());
        mocks.execute.mockResolvedValueOnce(undefined);
        dispatch(registry);
        await Promise.resolve();
        expect(mocks.show).not.toHaveBeenCalled();
    });
});
