import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readLongCaptureRustSources } from "../helpers/longCaptureRustSources";

const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const commandSource = readFileSync(resolve(process.cwd(), "src/services/appCommandListeners.ts"), "utf8");
const nativeActionSource = readFileSync(resolve(process.cwd(), "src/services/appNativeActionController.ts"), "utf8");
const selectionSource = readFileSync(resolve(process.cwd(), "src/hooks/useSelection.ts"), "utf8");
const autoLongCaptureSource = readFileSync(resolve(process.cwd(), "src/hooks/autoLongCaptureController.ts"), "utf8");
const captureUnitSource = readFileSync(resolve(process.cwd(), "src/hooks/captureUnitController.ts"), "utf8");
const captureApiSource = readFileSync(resolve(process.cwd(), "src/services/apiCapture.ts"), "utf8");
const captureStateSource = readFileSync(resolve(process.cwd(), "src/services/captureState.ts"), "utf8");
const rustSource = readHookLibRustSources();
const longCaptureSource = readLongCaptureRustSources();

describe("Hook long capture contract", () => {
    it("wires a dedicated long-capture selection mode through frontend and Tauri entrypoints", () => {
        expect(appSource).toContain("registerAppCommandListeners");
        expect(commandSource).toContain('listen("trigger-long-capture"');
        expect(commandSource).toContain('beginCaptureSelection("long-vertical")');
        expect(nativeActionSource).toContain("setCaptureMode(captureStart.captureMode)");

        expect(captureStateSource).toContain('mode === "long-vertical"');
        expect(selectionSource).toContain("isLongCaptureMode(activeCaptureMode)");
        expect(selectionSource).toContain("startAutoLongCaptureSession");
        expect(autoLongCaptureSource).toContain("api.analyzeLongCapturePair");
        expect(autoLongCaptureSource).toContain("api.stitchLongCaptureFrames");
        expect(autoLongCaptureSource).not.toContain("api.captureVerticalLongRegion(");
        expect(autoLongCaptureSource).toContain('await api.setOverlayClickThrough(true)');
        expect(captureUnitSource).toContain("...createCaptureMeta(mode, rect, scrollAxis)");
        expect(captureStateSource).toContain('kind: isLongCaptureMode(mode) ? "long" : "region"');

        expect(captureApiSource).toContain("analyzeLongCapturePair");
        expect(captureApiSource).toContain('"analyze_long_capture_pair"');
        expect(captureApiSource).toContain("stitchLongCaptureFrames");
        expect(captureApiSource).toContain('"stitch_long_capture_frames"');
        expect(captureApiSource).not.toContain("console.log(");

        expect(rustSource).toContain("fn trigger_long_capture_mode");
        expect(rustSource).toContain('"trigger-long-capture-finish"');
        expect(rustSource).toContain('MenuItem::with_id(app, "long_capture", "长截图 (Ctrl+3)"');
        expect(rustSource).toContain("Code::Digit3");
        expect(rustSource).toContain("analyze_long_capture_pair");
        expect(rustSource).toContain("stitch_long_capture_frames");
    });

    it("keeps a direct window-message fallback for long-capture scrolling when global input is ignored", () => {
        expect(longCaptureSource).toContain("SendMessageW");
        expect(longCaptureSource).toContain("WM_MOUSEWHEEL");
        expect(longCaptureSource).toContain("WM_VSCROLL");
        expect(longCaptureSource).toContain("GetParent");
        expect(longCaptureSource).toContain("GetClassNameW");
    });

    it("does not physically left-click selected content while auto-scrolling", () => {
        expect(longCaptureSource).not.toContain("MOUSEEVENTF_LEFTDOWN");
        expect(longCaptureSource).not.toContain("MOUSEEVENTF_LEFTUP");
    });

    it("guards automatic long-capture sampling against stale async session writes", () => {
        expect(autoLongCaptureSource).toContain("let sessionId = 0;");
        expect(autoLongCaptureSource).toContain("let finishing = false;");
        expect(autoLongCaptureSource).toContain("const isCurrent = (candidateSessionId: number)");
        expect(autoLongCaptureSource).toContain("sampleAutoLongCaptureFrame(candidateSessionId)");
        expect(autoLongCaptureSource).toContain("scheduleSample(candidateSessionId)");
        expect(autoLongCaptureSource).toContain("const framesSnapshot = [...frames]");
        expect(autoLongCaptureSource).not.toMatch(/if \(frames\.length === 0\)\s*{\s*await sampleAutoLongCaptureFrame\(\);/);
    });
});
