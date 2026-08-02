import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("HDR capture contract", () => {
  it("captures HDR displays as transient R16G16B16A16Float frames", () => {
    const screenshotSource = readSource("src-tauri/src/screenshot.rs");
    const direct3dSource = readSource("src-tauri/crates/scap-direct3d/src/lib.rs");

    expect(direct3dSource).toContain("R16G16B16A16Float");
    expect(screenshotSource).toContain("DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO");
    expect(screenshotSource).toContain("DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL");
    expect(screenshotSource).toContain("try_hdr_capture_transient");
    expect(screenshotSource).toContain("PixelFormat::R16G16B16A16Float");
    expect(screenshotSource).toContain('std::env::var("HOOK_CAPTURE_DYNAMIC_RANGE")');
    const hdrTransientStart = screenshotSource.indexOf("fn try_hdr_capture_transient(");
    const hdrTransientEnd = screenshotSource.indexOf("fn try_fast_capture(", hdrTransientStart);
    expect(hdrTransientStart).toBeGreaterThan(-1);
    expect(hdrTransientEnd).toBeGreaterThan(hdrTransientStart);
    expect(screenshotSource.slice(hdrTransientStart, hdrTransientEnd)).not.toContain("PERSISTENT_CAPTURER");
  });

  it("selects HDR and SDR capture backends from the active capture monitor", () => {
    const captureSource = readSource("src-tauri/src/capture.rs");
    const screenshotSource = readSource("src-tauri/src/screenshot.rs");
    const capturePlanStart = screenshotSource.indexOf("fn capture_plan(");
    const capturePlanEnd = screenshotSource.indexOf("fn capture_sdr_from_plan(", capturePlanStart);
    const capturePlan = screenshotSource.slice(capturePlanStart, capturePlanEnd);

    expect(captureSource).toContain("fn capture_display_metrics(window: &Window)");
    expect(captureSource).toContain("Some(display_metrics),");
    expect(screenshotSource).toContain("fn capture_display_for_metrics(");
    expect(screenshotSource).toContain("Display::list()");
    expect(capturePlan).toContain("capture_display_for_metrics(display_metrics)");
    expect(capturePlan).not.toContain("let display = Display::primary()");
    expect(screenshotSource).toContain("hdr_display_info_for(&plan.display)");
    expect(screenshotSource).toContain("plan.physical_origin_x + plan.crop.left as i32");
    expect(screenshotSource).toContain("plan.physical_origin_y + plan.crop.top as i32");
  });

  it("writes real 16-bit BT.2020 PQ PNG metadata instead of relabeling SDR pixels", () => {
    const libSource = readSource("src-tauri/src/lib.rs");
    const screenshotSource = readSource("src-tauri/src/screenshot.rs");

    expect(screenshotSource).toContain("scrgb_buffer_to_hdr_pq");
    expect(screenshotSource).toContain("pq_oetf_from_nits");
    expect(libSource).toContain("png::BitDepth::Sixteen");
    expect(libSource).toContain("write_chunk(png::chunk::cICP, &[9, 16, 0, 1])");
    expect(libSource).toContain("png::chunk::mDCV");
    expect(libSource).toContain("png::chunk::cLLI");
  });

  it("keeps long capture SDR and degrades HDR through SDR WGC before GDI", () => {
    const captureSource = readSource("src-tauri/src/capture.rs");
    const screenshotSource = readSource("src-tauri/src/screenshot.rs");
    const longCaptureSource = readSource("src-tauri/src/long_capture.rs");

    expect(captureSource).toContain("capture_region_with_dynamic_range");
    expect(screenshotSource).toContain("falling_back_to_sdr_wgc_then_gdi");
    expect(screenshotSource).toContain("profile == CaptureWorkloadProfile::StandardRegion");
    expect(longCaptureSource).toContain("CaptureWorkloadProfile::LongCapture");
    expect(longCaptureSource).not.toContain("capture_region_with_dynamic_range");
  });

  it("exposes HDR and downgrade metadata to stickers", () => {
    const apiSource = readSource("src/services/api.ts");
    const selectionSource = readSource("src/hooks/useSelection.ts");

    expect(apiSource).toContain('dynamicRange?: "sdr" | "hdr"');
    expect(apiSource).toContain('colorSpace?: "srgb" | "bt2020-pq"');
    expect(apiSource).toContain("downgradedFromHdr?: boolean");
    expect(selectionSource).toContain("dynamicRange: response.dynamicRange");
    expect(selectionSource).toContain("captureBackend: response.captureBackend");
  });
});
