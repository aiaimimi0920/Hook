import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("HDR capture contract", () => {
  it("captures HDR displays as transient R16G16B16A16Float frames", () => {
    const capturePixelSource = readSource(
      "src-tauri/src/screenshot/capture_pixels.rs",
    );
    const hdrAnalysisSource = readSource(
      "src-tauri/src/screenshot/hdr_analysis.rs",
    );
    const hdrDisplaySource = readSource(
      "src-tauri/src/screenshot/hdr_display.rs",
    );
    const wgcSessionSource = readSource(
      "src-tauri/src/screenshot/wgc_session.rs",
    );
    const direct3dSource = readSource(
      "src-tauri/crates/scap-direct3d/src/settings.rs",
    );

    expect(direct3dSource).toContain("R16G16B16A16Float");
    expect(hdrDisplaySource).toContain("DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO");
    expect(hdrDisplaySource).toContain("DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL");
    expect(wgcSessionSource).toContain("try_hdr_capture_transient");
    expect(wgcSessionSource).toContain("PixelFormat::R16G16B16A16Float");
    expect(hdrAnalysisSource).toContain(
      'std::env::var("HOOK_CAPTURE_DYNAMIC_RANGE")',
    );
    const hdrTransientStart = wgcSessionSource.indexOf("fn try_hdr_capture_transient(");
    const hdrTransientEnd = wgcSessionSource.indexOf("fn try_fast_capture(", hdrTransientStart);
    expect(hdrTransientStart).toBeGreaterThan(-1);
    expect(hdrTransientEnd).toBeGreaterThan(hdrTransientStart);
    expect(wgcSessionSource.slice(hdrTransientStart, hdrTransientEnd)).not.toContain(
      "PERSISTENT_CAPTURER",
    );
  });

  it("selects HDR and SDR capture backends from the active capture monitor", () => {
    const captureSource = readSource("src-tauri/src/capture.rs");
    const dispatchSource = readSource("src-tauri/src/screenshot/dispatch.rs");
    const displaySelectionSource = readSource(
      "src-tauri/src/screenshot/display_selection.rs",
    );
    const capturePlanStart = displaySelectionSource.indexOf(
      "pub(super) fn capture_plan(",
    );
    const capturePlan = displaySelectionSource.slice(capturePlanStart);

    expect(captureSource).toContain("fn capture_display_metrics(window: &Window)");
    expect(captureSource).toContain("Some(display_metrics),");
    expect(capturePlanStart).toBeGreaterThan(-1);
    expect(displaySelectionSource).toContain("fn capture_display_for_metrics(");
    expect(displaySelectionSource).toContain("Display::list()");
    expect(capturePlan).toContain("capture_display_for_metrics(display_metrics)");
    expect(capturePlan).not.toContain("let display = Display::primary()");
    expect(dispatchSource).toContain("hdr_display_info_for(&plan.display)");
    expect(dispatchSource).toContain("checked_gdi_capture_rect(");
    expect(dispatchSource).not.toContain("plan.crop.left as i32");
    expect(dispatchSource).not.toContain("plan.crop.top as i32");
  });

  it("writes real 16-bit BT.2020 PQ PNG metadata instead of relabeling SDR pixels", () => {
    const encodingSource = readSource(
      "src-tauri/src/native/long_capture_encoding.rs",
    );
    const capturePixelSource = readSource(
      "src-tauri/src/screenshot/capture_pixels.rs",
    );

    expect(capturePixelSource).toContain("scrgb_buffer_to_hdr_pq");
    expect(capturePixelSource).toContain("pq_oetf_from_nits");
    expect(encodingSource).toContain("png::BitDepth::Sixteen");
    expect(encodingSource).toContain("write_chunk(png::chunk::cICP, &[9, 16, 0, 1])");
    expect(encodingSource).toContain("png::chunk::mDCV");
    expect(encodingSource).toContain("png::chunk::cLLI");
  });

  it("keeps long capture SDR and degrades HDR through SDR WGC before GDI", () => {
    const captureSource = readSource("src-tauri/src/capture.rs");
    const dispatchSource = readSource("src-tauri/src/screenshot/dispatch.rs");
    const hdrAnalysisSource = readSource(
      "src-tauri/src/screenshot/hdr_analysis.rs",
    );
    const longCaptureSource = readSource(
      "src-tauri/src/long_capture/capture_loop.rs",
    );

    expect(captureSource).toContain("capture_region_with_dynamic_range");
    expect(dispatchSource).toContain("falling_back_to_sdr_wgc_then_gdi");
    expect(hdrAnalysisSource).toContain(
      "profile == CaptureWorkloadProfile::StandardRegion",
    );
    expect(longCaptureSource).toContain("CaptureWorkloadProfile::LongCapture");
    expect(longCaptureSource).not.toContain("capture_region_with_dynamic_range");
  });

  it("exposes HDR and downgrade metadata to stickers", () => {
    const apiTypesSource = readSource("src/services/apiTypes.ts");
    const captureUnitSource = readSource("src/hooks/captureUnitController.ts");

    expect(apiTypesSource).toContain('dynamicRange?: "sdr" | "hdr"');
    expect(apiTypesSource).toContain('colorSpace?: "srgb" | "bt2020-pq"');
    expect(apiTypesSource).toContain("downgradedFromHdr?: boolean");
    expect(captureUnitSource).toContain("dynamicRange: response.dynamicRange");
    expect(captureUnitSource).toContain("captureBackend: response.captureBackend");
  });
});
