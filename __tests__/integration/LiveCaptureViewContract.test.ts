import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Live is a shared sticker Unit, not a parallel window implementation", () => {
    it("does not mount a global LIVE relay badge on the desktop", () => {
        expect(read("src/components/LiveFeatures.tsx")).not.toContain("LiveRelayPanel");
        expect(read("src/components/LiveFeatures.tsx")).toContain("LiveRelayLayer");
    });
    it("uses CanvasUnits and UnitView for all ordinary panels and interaction", () => {
        expect(existsSync(resolve(process.cwd(), "src/components/LiveCaptureLayer.tsx"))).toBe(false);
        expect(read("src/services/liveCaptureUnit.ts")).toContain("graphStore.actions.addUnit");
        expect(read("src/components/UnitView.tsx")).toContain("<UnitLiveCaptureInput");
        const input = read("src/components/UnitLiveCaptureInput.tsx");
        expect(input).not.toContain('data-hook-global-shortcuts="ignore"');
        expect(input).not.toContain("updateGeometry");
        expect(input).toContain("props.onMouseDown(event)");
    });

    it("keeps green/yellow outlines and source input while leaving editor gestures to UnitView", () => {
        const input = read("src/components/UnitLiveCaptureInput.tsx");
        expect(input).toContain("activeStickerEditTargetId() !== props.unit.id");
        expect(input).toContain("OVERLAY_GLOBAL_MOUSE_UP_EVENT");
        expect(input).not.toContain("<button");
        const style = read("src/components/UnitLiveCaptureInput.css");
        expect(style).toContain("var(--theme-success)");
        expect(style).toContain("var(--theme-signal)");
        expect(style).toContain("clip-path: polygon");
    });
});
