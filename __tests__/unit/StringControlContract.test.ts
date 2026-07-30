import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
    readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("StringControl text-field interactivity contract", () => {
    it("keeps native text interactivity hooks on the inline query input", () => {
        const controlSource = readSource("src/components/params/controls/StringControl.tsx");
        const cssSource = readSource("src/app.css");
        const apiSource = readSource("src/services/api.ts");
        const panelSource = readSource("src/components/UnitParamsPanel.tsx");

        expect(controlSource).toContain("const focusEditableTarget = (");
        expect(controlSource).toContain("onPointerDown={focusEditableTarget}");
        expect(controlSource).toContain("onMouseDown={focusEditableTarget}");
        expect(controlSource).toContain('from "../../../services/api"');
        expect(controlSource).toContain("void api.focusOverlayWindow()");
        expect(apiSource).toContain("focusOverlayWindow");
        expect(panelSource).toContain("void api.focusOverlayWindow();");
        expect(panelSource).toContain('class="hook-terminal-input w-full h-[150px]');
        expect(cssSource).toContain("user-select: text;");
        expect(cssSource).toContain("-webkit-user-select: text;");
    });
});
