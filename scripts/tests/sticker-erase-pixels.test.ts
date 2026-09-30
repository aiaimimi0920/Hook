import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";
import type { Unit } from "../../src/types/unit";
import type { renderStickerCompositeWithAnnotations } from "../../src/services/stickerCompositeRenderer";
import type { createLiveStickerEraseSession } from "../../src/services/stickerBitmapLayers";

test("repeated content erasing preserves untouched pixels at fractional sticker sizes", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url)).replaceAll("\\", "/");
    const result = await build({
        configFile: false,
        root,
        logLevel: "error",
        plugins: [{
            name: "erase-pixel-test-entry",
            resolveId(id) {
                if (id.endsWith("erase-test-entry")) return "\0erase-test-entry";
                if (id.endsWith("/stickerExportSource")) return `\0${id}`;
            },
            load(id) {
                // Source selection is supplied explicitly; no Tauri/store runtime is needed.
                if (id.endsWith("/stickerExportSource")) {
                    return "export const resolveRuntimeStickerCompositeBaseImageSrc = () => undefined;";
                }
                if (id === "\0erase-test-entry") return `
                    export { renderStickerCompositeWithAnnotations } from ${JSON.stringify(`${root}src/services/stickerCompositeRenderer.ts`)};
                    export { createLiveStickerEraseSession } from ${JSON.stringify(`${root}src/services/stickerBitmapLayers.ts`)};
                `;
            },
        }],
        build: {
            write: false,
            minify: false,
            lib: { entry: "erase-test-entry", name: "ErasePixels", formats: ["iife"] },
        },
    });
    const chunk = (Array.isArray(result) ? result : [result])
        .flatMap((output) => "output" in output ? output.output : [])
        .find((item) => item.type === "chunk");
    assert.ok(chunk && chunk.type === "chunk");
    const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
    try {
        const page = await browser.newPage();
        await page.addScriptTag({ content: chunk.code });
        const reports = await page.evaluate(async () => {
            const api = (window as unknown as { ErasePixels: {
                renderStickerCompositeWithAnnotations: typeof renderStickerCompositeWithAnnotations;
                createLiveStickerEraseSession: typeof createLiveStickerEraseSession;
            } }).ErasePixels;
            const reports = [];
            for (const scale of [1, 1.25, 1.5, 2]) {
                const canvas = document.createElement("canvas");
                canvas.width = 401;
                canvas.height = 257;
                const context = canvas.getContext("2d")!;
                const pixels = context.createImageData(canvas.width, canvas.height);
                for (let y = 0; y < canvas.height; y++) {
                    for (let x = 0; x < canvas.width; x++) {
                        const offset = (y * canvas.width + x) * 4;
                        const value = (x + y) % 2 ? 255 : 0;
                        pixels.data.set([value, value, value, 255], offset);
                    }
                }
                context.putImageData(pixels, 0, 0);
                const unit: Unit = {
                    id: "erase-pixels", type: "sticker", x: 0, y: 0,
                    w: canvas.width / scale, h: canvas.height / scale,
                    params: {}, inputs: [], outputs: [],
                    data: { src: canvas.toDataURL("image/png") },
                };
                const changed = [];
                for (let stroke = 0; stroke < 12; stroke++) {
                    const baseLayerSrc = await api.renderStickerCompositeWithAnnotations(unit, [], {
                        baseImageSrcOverride: unit.data.src,
                        includeRasterizedAnnotationLayer: false,
                        outputMode: "source-resolution",
                    });
                    const session = await api.createLiveStickerEraseSession({
                        mode: "content", baseLayerSrc,
                        size: { w: unit.w, h: unit.h },
                        previewCanvas: document.createElement("canvas"),
                    });
                    session.queueErase([{ x: 10, y: 10 }], 6);
                    const next = session.finish();
                    session.destroy();
                    unit.data.src = next.baseLayerSrc;
                    const image = new Image();
                    image.src = next.baseLayerSrc;
                    await image.decode();
                    if (image.naturalWidth !== canvas.width || image.naturalHeight !== canvas.height) {
                        throw new Error("Erasing changed source dimensions");
                    }
                    context.clearRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(image, 0, 0);
                    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
                    let differences = 0;
                    // Exclude only the stroke and a two-pixel antialiasing margin.
                    for (let y = 0; y < canvas.height; y++) {
                        for (let x = 0; x < canvas.width; x++) {
                            if (Math.abs(x - 10 * scale) <= 3 * scale + 2
                                && Math.abs(y - 10 * scale) <= 3 * scale + 2) continue;
                            const offset = (y * canvas.width + x) * 4;
                            for (let c = 0; c < 4; c++) if (actual[offset + c] !== pixels.data[offset + c]) differences++;
                        }
                    }
                    changed.push(differences);
                    if (actual[(Math.round(10 * scale) * canvas.width + Math.round(10 * scale)) * 4 + 3] !== 0) {
                        throw new Error("Eraser did not remove the target pixel");
                    }
                }
                reports.push({ scale, changed });
            }
            return reports;
        });
        for (const report of reports) {
            assert.deepEqual(report.changed, Array(12).fill(0), `untouched RGBA channels at scale ${report.scale}`);
        }
    } finally {
        await browser.close();
    }
});
