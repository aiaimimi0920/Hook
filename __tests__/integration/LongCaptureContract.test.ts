import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const selectionSource = readFileSync(resolve(process.cwd(), "src/hooks/useSelection.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const captureStateSource = readFileSync(resolve(process.cwd(), "src/services/captureState.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const longCaptureSource = readFileSync(resolve(process.cwd(), "src-tauri/src/long_capture.rs"), "utf8");

describe("Hook long capture contract", () => {
    it("wires a dedicated long-capture selection mode through frontend and Tauri entrypoints", () => {
        expect(appSource).toContain('listen("trigger-long-capture"');
        expect(appSource).toContain('beginCaptureSelection("long-vertical")');
        expect(appSource).toContain("setCaptureMode(captureStart.captureMode)");

        expect(captureStateSource).toContain('mode === "long-vertical"');
        expect(selectionSource).toContain("isLongCaptureMode(activeCaptureMode)");
        expect(selectionSource).toContain("startAutoLongCaptureSession");
        expect(selectionSource).toContain("api.analyzeLongCapturePair");
        expect(selectionSource).toContain("api.stitchLongCaptureFrames");
        expect(selectionSource).not.toContain("api.captureVerticalLongRegion(");
        expect(selectionSource).toContain('await api.setOverlayClickThrough(true)');
        expect(selectionSource).toContain("captureMeta: createCaptureMeta(mode, rect, scrollAxis)");
        expect(captureStateSource).toContain('kind: isLongCaptureMode(mode) ? "long" : "region"');

        expect(apiSource).toContain("analyzeLongCapturePair");
        expect(apiSource).toContain('"analyze_long_capture_pair"');
        expect(apiSource).toContain("stitchLongCaptureFrames");
        expect(apiSource).toContain('"stitch_long_capture_frames"');

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
        expect(selectionSource).toContain("autoLongCaptureSessionId");
        expect(selectionSource).toContain("autoLongCaptureFinishing");
        expect(selectionSource).toContain("isAutoLongCaptureSessionCurrent");
        expect(selectionSource).toContain("sampleAutoLongCaptureFrame(sessionId");
        expect(selectionSource).toContain("scheduleAutoLongCaptureSample(sessionId");
        expect(selectionSource).toContain("const framesSnapshot = [...autoLongCaptureFrames]");
        expect(selectionSource).not.toMatch(/if \(autoLongCaptureFrames\.length === 0\)\s*{\s*await sampleAutoLongCaptureFrame\(\);/);
    });
});
