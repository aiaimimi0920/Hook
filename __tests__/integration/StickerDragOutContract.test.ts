import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(
  resolve(process.cwd(), "src/components/UnitView.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  resolve(process.cwd(), "src/services/api.ts"),
  "utf8",
);
const captureRustSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/capture.rs"),
  "utf8",
);
const clipboardSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useClipboard.ts"),
  "utf8",
);
const useFileDropSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useFileDrop.ts"),
  "utf8",
);
const rustSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/lib.rs"),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as {
  app?: {
    windows?: Array<{
      dragDropEnabled?: boolean;
    }>;
  };
};

describe("Hook sticker drag-out contract", () => {
  const extractRustSection = (startMarker: string, endMarker: string) => {
    const start = rustSource.indexOf(startMarker);
    const end = rustSource.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return rustSource.slice(start, end);
  };
  const extractTsSection = (source: string, startMarker: string, endMarker: string) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it("keeps Shift as the drag-out modifier and still publishes DownloadURL payloads", () => {
    expect(unitViewSource).toContain("if (!e.shiftKey)");
    expect(unitViewSource).toContain('e.dataTransfer!.setData("DownloadURL", dlUrl)');
  });

  it("keeps the browser-only HTML5 drag fallback free of obvious dead debug artifacts", () => {
    expect(unitViewSource.match(/effectAllowed = \"all\"/g)?.length ?? 0).toBe(1);
    expect(unitViewSource).not.toContain('console.log("DragStart initiated. Shift:", e.shiftKey);');
    expect(unitViewSource).not.toContain('console.log("DragStart: Set file-backed DownloadURL", filename, fileUrl);');
    expect(unitViewSource).not.toContain('console.log("DragStart: Set DownloadURL", filename, blobUrl);');
    expect(unitViewSource).not.toContain("const img = new Image();");
    expect(unitViewSource).not.toContain('console.log(`[UnitView] Rendering Image (Fixed Size Mode) - Src Length: ${displaySrc().length}`);');
    expect(unitViewSource).not.toContain('console.log("Native sticker drag started:", path);');
    expect(rustSource).not.toContain('println!(\n        "Started native sticker drag with payload: {}"');
  });

  it("supports file-backed stickers when dragging out to a Windows folder", () => {
    expect(unitViewSource).toContain("const dragOutFilePath = props.unit.data.filePath");
    expect(unitViewSource).toContain('const fileUrl = encodeURI(`file://${normalizedFilePath}`);');
    expect(unitViewSource).toContain('e.dataTransfer!.setData("text/uri-list", fileUrl);');
    expect(unitViewSource).toContain('e.dataTransfer!.setData("text/plain", dragOutFilePath);');
    expect(unitViewSource.indexOf("if (dragOutFilePath)")).toBeLessThan(
      unitViewSource.indexOf('if (src.startsWith("data:"))'),
    );
  });

  it("disables the native webview drag-drop bridge so Windows HTML5 drag-out can work", () => {
    expect(tauriConfig.app?.windows?.[0]?.dragDropEnabled).toBe(false);
  });

  it("keeps image import working through DOM drop instead of tauri://drag-drop interception", () => {
    expect(useFileDropSource).toContain('window.addEventListener("drop", handleDrop)');
    expect(useFileDropSource).toContain('window.addEventListener("dragover", handleDragOver)');
    expect(useFileDropSource).toContain("e.dataTransfer?.files");
    expect(useFileDropSource).not.toContain('listen("tauri://drag-drop"');
  });

  it("uses a native Windows file drag command instead of relying only on HTML5 DownloadURL in Tauri", () => {
    expect(apiSource).toContain("beginStickerNativeFileDrag");
    expect(apiSource).toContain("begin_sticker_native_file_drag");
    expect(apiSource).toContain("beginStickerNativeFileDragFromPath");
    expect(apiSource).toContain("begin_sticker_native_file_drag_from_path");

    expect(unitViewSource).toContain("api.beginStickerNativeFileDrag(");
    expect(unitViewSource).toContain("api.beginStickerNativeFileDragFromPath(");
    expect(unitViewSource).toContain("resolveExistingNativeDragFilePath()");
    expect(unitViewSource).toContain("dragOutFilePath");
    expect(unitViewSource).toContain("renderStickerComposite(");
    expect(unitViewSource).toContain('unitContainerRef?.addEventListener("pointerdown", handleNativeStickerPointerDownCapture, true)');
    expect(unitViewSource).toContain('window.addEventListener("pointermove", handlePendingNativeDragPointerMove, true)');
    expect(unitViewSource).toContain('window.addEventListener("pointerup", handlePendingNativeDragEnd, true)');
    expect(unitViewSource).toContain('window.addEventListener("pointercancel", handlePendingNativeDragEnd, true)');
    const pointerDownCaptureSection = extractTsSection(
      unitViewSource,
      "const handleNativeStickerPointerDownCapture = (event: PointerEvent) => {",
      "createEffect(() => {",
    );
    expect(pointerDownCaptureSection).not.toContain("void beginNativeStickerDrag();");
    expect(pointerDownCaptureSection).not.toContain("if (resolveExistingNativeDragFilePath())");

    expect(rustSource).toContain("fn begin_sticker_native_file_drag(");
    expect(rustSource).toContain("fn begin_sticker_native_file_drag_from_path(");
    expect(rustSource).toContain("drag::start_drag(");
    expect(rustSource).toContain("drag::DragItem::Files");
    expect(rustSource).toContain("drag::Image::File");
    const nativeDragHelper = extractRustSection(
      "fn start_native_file_drag(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag(",
    );
    expect(nativeDragHelper).not.toContain("run_on_main_thread");
    expect(nativeDragHelper).toContain("set_overlay_click_through_impl(&window, true)");
    expect(nativeDragHelper).toContain("refresh_overlay_interactivity_for_current_cursor(&window, hit_map)");
  });

  it("preserves pasted sticker drag-out snapshots so duplicated stickers can use the same fast native path", () => {
    expect(clipboardSource).toContain("dragOutFilePath: s.data.dragOutFilePath || s.data.filePath");
    expect(clipboardSource).toContain("dragOutFilePath: path");
    expect(clipboardSource).toContain("filePath: s.data.filePath");
    expect(clipboardSource).toContain("previewSrc: s.data.previewSrc");
    expect(clipboardSource).toContain("dragOutFilePath: clip.dragOutFilePath");
    expect(clipboardSource).toContain("filePath: clip.filePath");
    expect(unitViewSource).toContain("if (!useExistingPath) {");
    expect(unitViewSource).toContain("graphStore.actions.updateUnitData(props.unit.id, {");
  });

  it("stages a disposable drag file and allows move semantics so Shift-drag can land in Explorer folders", () => {
    expect(rustSource).toContain("fn stage_drag_out_file_copy(");
    expect(rustSource).toContain("drag::DragMode::Move");
    expect(rustSource).toContain("stage_drag_out_file_copy(&file_path)");
    expect(rustSource).toContain("native_drag_stage_created");
    const beginNativeDragFromBase64Section = extractRustSection(
      "fn begin_sticker_native_file_drag(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag_from_path(",
    );
    expect(beginNativeDragFromBase64Section).toContain("drop(file);");
    expect(beginNativeDragFromBase64Section).toContain("let staged_drag_file = stage_drag_out_file_copy(&file_path)?;");
    expect(beginNativeDragFromBase64Section).toContain("start_native_file_drag(window, staged_drag_file, hit_map.inner())");
  });

  it("persists fresh screenshot captures as file-backed stickers so shift-drag can use the fastest native path", () => {
    expect(captureRustSource).toContain("encode_rgb_image_as_file_capture_response");
    const captureRegionSection = captureRustSource.slice(
      captureRustSource.indexOf("pub async fn capture_region("),
      captureRustSource.indexOf("}", captureRustSource.indexOf("pub async fn capture_region(")) + 1,
    );
    expect(captureRegionSection).not.toContain("file_path: None");
  });
});
