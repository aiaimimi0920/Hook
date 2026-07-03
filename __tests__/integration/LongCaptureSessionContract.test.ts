import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const selectionSource = readFileSync(resolve(process.cwd(), "src/hooks/useSelection.ts"), "utf8");
const captureStateSource = readFileSync(resolve(process.cwd(), "src/services/captureState.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const longCaptureSource = readFileSync(resolve(process.cwd(), "src-tauri/src/long_capture.rs"), "utf8");
const tauriConfig = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));

describe("Hook long capture session contract", () => {
    it("exposes a backend-owned long capture session flow for Ctrl+3", () => {
        expect(apiSource).toContain("startLongCaptureSession");
        expect(apiSource).toContain("sampleLongCaptureSession");
        expect(apiSource).toContain("finishLongCaptureSession");
        expect(apiSource).toContain("cancelLongCaptureSession");

        expect(selectionSource).toContain("startAutoLongCaptureSession");
        expect(selectionSource).toContain("sampleAutoLongCaptureFrame");
        expect(selectionSource).toContain("finishAutoLongCaptureSession");
        expect(selectionSource).toContain("cancelAutoLongCaptureSession");

        expect(rustSource).toContain("start_long_capture_session");
        expect(rustSource).toContain("sample_long_capture_session");
        expect(rustSource).toContain("finish_long_capture_session");
        expect(rustSource).toContain("cancel_long_capture_session");
    });

    it("records non-duplicate frames during capture and drains background stitching before finish", () => {
        const sampleHelperStart = rustSource.indexOf("fn capture_and_classify_long_capture_sample");
        const sampleHelperEnd = rustSource.indexOf("#[tauri::command]\nfn set_capture_input_active");
        expect(sampleHelperStart).toBeGreaterThanOrEqual(0);
        expect(sampleHelperEnd).toBeGreaterThan(sampleHelperStart);
        const sampleHelperBody = rustSource.slice(sampleHelperStart, sampleHelperEnd);
        const sampleCommandStart = rustSource.indexOf("async fn sample_long_capture_session");
        const finishCommandStart = rustSource.indexOf("async fn finish_long_capture_session");
        expect(sampleCommandStart).toBeGreaterThanOrEqual(0);
        expect(finishCommandStart).toBeGreaterThan(sampleCommandStart);
        const sampleCommandBody = rustSource.slice(sampleCommandStart, finishCommandStart);

        expect(apiSource).toContain('status: "recorded" | "duplicate"');
        expect(rustSource).toContain("LongCaptureSessionSampleStatus");
        expect(rustSource).toContain("duplicate_count");
        expect(rustSource).toContain("classify_long_capture_recording_frame");
        expect(sampleHelperBody).not.toContain("analyze_long_capture_pair_images");
        expect(sampleCommandBody).toContain("record_long_capture_session_sample_result");
        expect(sampleCommandBody).toContain("spawn_long_capture_stitch_worker");
        expect(sampleCommandBody).not.toContain("push_frame");
        expect(rustSource).toContain("run_long_capture_stitch_worker");
        expect(rustSource).toContain("wait_for_long_capture_stitch_worker");
        expect(selectionSource).not.toContain("找不到重叠");
        expect(selectionSource).not.toContain("弱重叠");

        expect(rustSource).toContain("async fn finish_long_capture_session");
        expect(rustSource).toContain("wait_for_long_capture_stitch_worker");
        expect(rustSource).toContain("spawn_blocking");
        expect(rustSource).toContain("finish_long_capture_session");
        expect(rustSource).toContain("stitch_long_capture_frames");
        expect(longCaptureSource).toContain("aggregate_skip_no_overlap");
        expect(selectionSource).toContain("无法匹配的临时帧会自动跳过");
    });

    it("returns file-backed long-capture results to avoid large base64 IPC and sync payloads", () => {
        expect(apiSource).toContain("filePath?: string | null");
        expect(apiSource).toContain("fileUrl?: string | null");
        expect(rustSource).toContain("encode_rgb_image_as_file_capture_response");
        expect(rustSource).toContain("file_url_from_path");
        expect(selectionSource).toContain('import { convertFileSrc } from "@tauri-apps/api/core"');
        expect(selectionSource).toContain("const resolveCaptureResponseSrc");
        expect(selectionSource).toContain("convertFileSrc(response.filePath)");
        expect(selectionSource).toContain("src: resolveCaptureResponseSrc(response)");
        expect(selectionSource).toContain("filePath: response.filePath ?? undefined");
        expect(selectionSource).toContain("void syncService.performWorkflowSync()");
    });

    it("enables Tauri asset protocol for file-backed long-capture image previews", () => {
        expect(tauriConfig.app.security.assetProtocol.enable).toBe(true);
        expect(tauriConfig.app.security.assetProtocol.scope).toContain("$LOCALDATA/Hook/clipboard_cache/**");
        expect(tauriConfig.app.security.assetProtocol.scope).toContain("$TEMP/Hook/clipboard_cache/**");
    });

    it("falls back to a base64 preview only if a file-backed sticker image fails to load", () => {
        expect(unitViewSource).toContain("handleFileBackedImageLoadError");
        expect(unitViewSource).toContain("api.readImageFromPath(filePath)");
        expect(unitViewSource).toContain("graphStore.actions.updateUnitData(props.unit.id");
        expect(unitViewSource).toContain("previewSrc: fallbackSrc");
        expect(unitViewSource).toContain("onError={handleFileBackedImageLoadError}");
    });

    it("keeps automatic sampling off the UI hot path and allows finish to interrupt in-flight samples", () => {
        expect(rustSource).toContain("async fn sample_long_capture_session");
        expect(rustSource).toContain("LongCaptureSessionSampleWork");
        expect(rustSource).toContain("spawn_blocking");
        expect(rustSource).toContain("expected_frame_count");
        expect(selectionSource).toContain("if (autoLongCaptureFinishing) return false;");
    });

    it("keeps the long-capture guide visible without per-sample flicker", () => {
        expect(selectionSource).not.toContain("captureWithLongCaptureOverlaySuppressed");
        expect(selectionSource).not.toContain("setLongCaptureOverlaySuppressed(true)");
        expect(selectionSource).not.toContain("waitForLongCaptureOverlayPaint");
        expect(selectionSource).not.toContain("setLongCaptureOverlaySuppressed(false)");
        expect(appSource).not.toContain("longCaptureOverlaySuppressed");

        const sampleStart = selectionSource.indexOf("const sampleAutoLongCaptureFrame");
        const sampleEnd = selectionSource.indexOf("const startAutoLongCaptureSession", sampleStart);
        expect(sampleStart).toBeGreaterThanOrEqual(0);
        expect(sampleEnd).toBeGreaterThan(sampleStart);
        const sampleBody = selectionSource.slice(sampleStart, sampleEnd);

        expect(sampleBody).toContain("api.sampleLongCaptureSession(backendSessionId)");
        expect(sampleBody).toContain("api.captureRegion(");
    });

    it("excludes the overlay window from capture only during long-capture recording", () => {
        expect(apiSource).toContain("setOverlayCaptureExclusion");
        expect(apiSource).toContain("set_overlay_capture_exclusion");
        expect(rustSource).toContain("fn set_overlay_capture_exclusion");

        const startSessionStart = selectionSource.indexOf("const startAutoLongCaptureSession");
        const finishSessionStart = selectionSource.indexOf("const finishAutoLongCaptureSession");
        const cancelSessionStart = selectionSource.indexOf("const cancelAutoLongCaptureSession");
        expect(startSessionStart).toBeGreaterThanOrEqual(0);
        expect(finishSessionStart).toBeGreaterThan(startSessionStart);
        expect(cancelSessionStart).toBeGreaterThan(finishSessionStart);
        const startBody = selectionSource.slice(startSessionStart, finishSessionStart);
        const finishBody = selectionSource.slice(finishSessionStart, cancelSessionStart);
        const cancelBody = selectionSource.slice(cancelSessionStart);

        expect(startBody).toContain("await api.setOverlayCaptureExclusion(true)");
        expect(finishBody).toContain("await api.setOverlayCaptureExclusion(false)");
        expect(cancelBody).toContain("await api.setOverlayCaptureExclusion(false)");
    });

    it("accelerates backend long-capture sampling from real wheel input without trusting wheel direction", () => {
        expect(selectionSource).toContain("notifyAutoLongCaptureWheel");
        expect(selectionSource).toContain("resolveAutoLongCaptureWheelPollInterval");
        expect(selectionSource).toContain("resolveAutoLongCaptureSessionPollInterval");
        expect(selectionSource).not.toContain("autoLongCaptureWheelAxisHint");
        expect(selectionSource).toContain("sampleLongCaptureSession(backendSessionId)");
        expect(apiSource).not.toContain("axisHint?: LongCaptureAxis");
        expect(rustSource).not.toContain("axis_hint: Option<long_capture::LongCaptureAxis>");
        expect(longCaptureSource).toContain("analyze_auto_axis_by_image_content");
        expect(appSource).toContain('listen<{ deltaX?: number; deltaY?: number }>("trigger-long-capture-wheel"');
        expect(rustSource).toContain('window.emit("trigger-long-capture-wheel"');
        expect(rustSource).toContain("rdev::EventType::Wheel { delta_x, delta_y }");
    });

    it("starts long-capture sessions in auto-axis mode so horizontal captures can be detected", () => {
        expect(selectionSource).toContain("autoLongCaptureAxis = undefined;");
        expect(selectionSource).toContain("api.startLongCaptureSession(rect, autoLongCaptureAxis)");
        expect(selectionSource).not.toContain('autoLongCaptureAxis = "vertical";');
        expect(longCaptureSource).toContain("find_horizontal_right_fixed_chrome_candidate");
        expect(apiSource).toContain("axis?: LongCaptureAxis");
        expect(apiSource).toContain("direction?: LongCaptureDirection");
        expect(selectionSource).toContain("autoLongCaptureAxis = response.axis ?? autoLongCaptureAxis;");
        expect(selectionSource).toContain("autoLongCaptureDirection = response.direction ?? autoLongCaptureDirection;");
        expect(rustSource).toContain("axis: Option<long_capture::LongCaptureAxis>");
        expect(rustSource).toContain("direction: Option<long_capture::LongCaptureDirection>");
    });

    it("allows direction changes within the detected axis so users can scroll back and forth without duplicate seams", () => {
        expect(selectionSource).toContain("direction: undefined");
        expect(selectionSource).toContain("autoLongCaptureDirection = analysis.direction ?? autoLongCaptureDirection;");
        expect(rustSource).toContain("direction: None,");
        expect(rustSource).toContain("session.direction = analysis.direction;");
        expect(longCaptureSource).toContain("stitches_vertical_frames_from_mixed_up_down_pair_analyses_without_duplicates");
        expect(longCaptureSource).toContain("stitches_horizontal_frames_from_mixed_left_right_pair_analyses_without_duplicates");
    });

    it("uses aggregate signatures for finish-time stitching instead of pairwise historical frame matching", () => {
        expect(longCaptureSource).toContain("stitch_long_capture_frames_with_aggregate_signatures");
        expect(longCaptureSource).toContain("struct LongCaptureAggregate");
        expect(longCaptureSource).toContain("AxisSignatureList");
        expect(longCaptureSource).toContain("aggregate_axes_to_try");
        expect(longCaptureSource).toContain("find_aggregate_signature_match");
        expect(longCaptureSource).toContain("merge_frame_into_aggregate");
        expect(longCaptureSource).toContain("aggregate_signature_stitcher_handles_many_vertical_frames_by_matching_the_merged_image");
        expect(longCaptureSource).toContain("aggregate_signature_stitcher_prunes_the_other_axis_after_locking");
        expect(longCaptureSource).not.toContain("LongCapturePlacementCandidate");
        expect(longCaptureSource).not.toContain("stitch_reference_orders");
    });

    it("keeps high-frequency slow-scroll samples instead of waiting for large movement before saving a frame", () => {
        expect(captureStateSource).toContain("minNewContentPx: 2");
        expect(rustSource).toContain("LongCaptureFrameFingerprint");
        expect(rustSource).toContain("previous_fingerprint");
        expect(longCaptureSource).toContain("find_vertical_up_fixed_chrome_candidate");
        expect(longCaptureSource).toContain("find_horizontal_left_fixed_chrome_candidate");
        expect(longCaptureSource).toContain("candidate_is_fast_recording_match");
    });

    it("does not stop automatic long capture at a fixed temporary frame limit", () => {
        expect(captureStateSource).not.toContain("maxFrames: 160");
        expect(selectionSource).not.toContain("已达到临时帧上限");
        expect(selectionSource).not.toContain("autoLongCaptureOptions.maxFrames");
        expect(apiSource).not.toContain("max_frames_reached");
        expect(rustSource).not.toContain("LONG_CAPTURE_SESSION_MAX_FRAMES");
        expect(rustSource).not.toContain("MaxFramesReached");
    });
});
