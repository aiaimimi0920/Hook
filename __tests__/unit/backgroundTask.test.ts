import { afterEach, describe, expect, it, vi } from "vitest";

import { runBackgroundTask } from "../../src/services/backgroundTask";

describe("background task rejection handling", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("observes detached rejections without logging their potentially sensitive message", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        runBackgroundTask("capture activation", Promise.reject(new Error("secret-bearing detail")));
        await Promise.resolve();

        expect(error).toHaveBeenCalledWith("[Hook] capture activation failed (Error)");
        expect(JSON.stringify(error.mock.calls)).not.toContain("secret-bearing detail");
    });

    it("does not report successful detached work", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        runBackgroundTask("successful operation", Promise.resolve());
        await Promise.resolve();

        expect(error).not.toHaveBeenCalled();
    });
});
