import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("capture prompt contrast contract", () => {
    it("defines shared high-contrast capture prompt classes for screenshot flow overlays", () => {
        const css = readSource("src/app.css");

        expect(css).toContain(".hook-capture-chip");
        expect(css).toContain(".hook-capture-chip__tag");
        expect(css).toContain(".hook-capture-status-shell");
        expect(css).toContain(".hook-capture-status-title");
    });

    it("uses the shared capture chip class for live selection and long-capture area labels", () => {
        const canvasSelection = readSource("src/components/CanvasSelection.tsx");

        expect(canvasSelection).toContain("hook-capture-chip");
        expect(canvasSelection).toContain("hook-capture-chip__tag");
        expect(canvasSelection).not.toContain("bg-primary text-white");
    });

    it("uses a dedicated high-contrast terminal slab for the long-capture recording status overlay", () => {
        const app = readSource("src/app.tsx");

        expect(app).toContain("hook-capture-status-shell");
        expect(app).toContain("hook-capture-status-title");
        expect(app).not.toContain("rounded-xl border border-white/15 bg-black/70");
    });
});
