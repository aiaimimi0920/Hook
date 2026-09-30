import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("../../src/services/unitFailureNotice", () => ({ showUnitFailureNotice: mocks.show }));
import { liveCaptureAdmissionMessage, showLiveCaptureAdmissionError } from "../../src/services/liveCaptureAdmissionFeedback";

describe("Live admission feedback", () => {
    beforeEach(() => vi.clearAllMocks());
    it("shows a safe fallback for an unknown startup failure but not successful cleanup", () => {
        const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
        try {
            showLiveCaptureAdmissionError(undefined);
            expect(alert).not.toHaveBeenCalled();
            showLiveCaptureAdmissionError(new Error("https://private.example/secret"));
            expect(alert).not.toHaveBeenCalled();
            expect(mocks.show).toHaveBeenCalledOnce();
            expect(mocks.show.mock.calls[0][0].message).toContain("启动失败");
            expect(mocks.show.mock.calls[0][0].message).not.toContain("private.example");
        } finally { alert.mockRestore(); }
    });
    it("preserves an explicit owner for a startup failure", () => {
        showLiveCaptureAdmissionError("live_resource_gpu_pressure", "owner");
        expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining("显存"),
        }), "owner");
    });
    it("explains resource refusal without claiming a fixed four-source limit", () => {
        expect(liveCaptureAdmissionMessage("live_resource_gpu_pressure")).toContain("显存");
        expect(liveCaptureAdmissionMessage(new Error("live_resource_cooldown"))).toContain("保护期");
        expect(liveCaptureAdmissionMessage("live_resource_hard_limit")).toContain("16");
    });
    it("does not display arbitrary native errors or source content", () => {
        expect(liveCaptureAdmissionMessage("https://private.example/secret")).toBeUndefined();
        expect(liveCaptureAdmissionMessage({ message: "live_resource_gpu_pressure" })).toBeUndefined();
        expect(liveCaptureAdmissionMessage(undefined)).toBeUndefined();
    });
});
