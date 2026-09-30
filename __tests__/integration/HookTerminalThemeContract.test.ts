import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const readAppCss = () => [
    "theme-foundation.css",
    "terminal-primitives.css",
    "feature-surfaces.css",
    "unit-workspace.css",
    "settings-dialog.css",
    "parameter-controls.css",
].map((name) => readSource(`src/styles/${name}`)).join("\n");

describe("hook terminal theme contract", () => {
    it("defines canonical Neuro colors once and maps Hook semantics through aliases", () => {
        const css = readAppCss();

        expect(css).toContain("--neuro-signal-yellow: #d9ff38;");
        expect(css).toContain("--neuro-signal-green: #22c55e;");
        expect(css).toContain("--neuro-info-blue: #06b6d4;");
        expect(css).toContain("--neuro-danger-red: #f43f5e;");
        expect(css).toContain("--neuro-panel: #0e1218;");
        expect(css).toContain("--theme-signal: var(--neuro-signal-yellow);");
        expect(css).toContain("--theme-success: var(--neuro-signal-green);");
        expect(css).toContain("--theme-info: var(--neuro-info-blue);");
        expect(css).toContain("--theme-danger: var(--neuro-danger-red);");
        expect(css.match(/#d9ff38/g)).toHaveLength(1);
        expect(css.match(/#22c55e/g)).toHaveLength(1);
        expect(css).not.toMatch(/^\s*color:\s*var\(--theme-signal\);/m);
        expect(css).toContain("--radius-lg: 0px;");
        expect(css).not.toContain("Lavender Dream Theme");
        expect(css).not.toContain("--primary: #B1B2FF;");
        expect(css).not.toContain("--shadow-glow:");
    });

    it("uses shared terminal shell classes for context menu, tab panels, shift+1 actions menu, and review panels", () => {
        const contextMenu = readSource("src/components/StickerContextMenuPanel.tsx");
        const snapshotMenu = readSource("src/components/StickerSnapshotListPanel.tsx");
        const paramsPanel = readSource("src/components/UnitParamsPanel.tsx");
        const actionsBar = readSource("src/components/UnitActionsMenu.tsx");
        const addNodeMenu = readSource("src/components/UnitAddNodeMenu.tsx");
        const historyPanel = readSource("src/components/HistoryPanel.tsx");
        const groupBar = readSource("src/components/StickerGroupBar.tsx");
        const colorPicker = readSource("src/components/ColorPicker.tsx");

        expect(contextMenu).toContain("hook-context-menu-shell");
        expect(snapshotMenu).toContain("hook-context-menu-shell");
        expect(paramsPanel).toContain("hook-terminal-shell");
        expect(actionsBar).toContain("hook-actions-shell");
        expect(addNodeMenu).toContain("hook-terminal-shell");
        expect(historyPanel).toContain("hook-terminal-shell");
        expect(groupBar).toContain("hook-terminal-shell");
        expect(colorPicker).toContain("hook-terminal-shell");
    });

    it("removes rounded shell styling and glow-heavy blue-purple accents from tab and shift+1 surfaces", () => {
        const actionsBar = readSource("src/components/UnitActionsMenu.tsx");
        const addNodeMenu = readSource("src/components/UnitAddNodeMenu.tsx");
        const paramsPanel = [
            readSource("src/components/UnitParamsPanel.tsx"),
            readSource("src/components/UnitParamsExpandedSettings.tsx"),
        ].join("\n");

        expect(actionsBar).not.toContain("bg-blue-500");
        expect(actionsBar).not.toContain("shadow-[0_0_10px");
        expect(addNodeMenu).not.toContain("rounded-[16px]");
        expect(addNodeMenu).not.toContain("#B1B2FF");
        expect(addNodeMenu).not.toContain("#AAC4FF");
        expect(paramsPanel).not.toContain("bg-blue-500");
        expect(paramsPanel).not.toContain('"border-radius": "var(--radius-lg)"');
    });

    it("replaces cyan-selected editing chrome with signal-yellow terminal classes", () => {
        const topStrip = [
            readSource("src/components/StickerTopStrip.tsx"),
            readSource("src/components/StickerTopStripCreateTools.tsx"),
            readSource("src/components/StickerTopStripEditActions.tsx"),
            readSource("src/components/StickerTopStripSurfaceView.tsx"),
        ].join("\n");
        const propertyBar = readSource("src/components/StickerTopStripPropertyBar.tsx");
        const propertyBarFields = readSource("src/components/stickerTopStripPropertyBarFields.tsx");

        expect(topStrip).toContain("hook-toolbar-button--active");
        expect(topStrip).toContain("hook-toolbar-menu-item--active");
        expect(topStrip).not.toContain("bg-cyan-500/20");
        expect(propertyBarFields).toContain("hook-mini-toggle--active");
        expect(propertyBarFields).toContain("hook-mini-switch--active");
        expect(propertyBar).not.toContain("border-cyan-400");
    });

    it("routes parameter chrome through semantic tokens without purple hardcoding", () => {
        const paramControl = readSource("src/components/params/UnitParamControl.tsx");
        const numberControl = readSource("src/components/params/controls/NumberControl.tsx");
        const links = readSource("src/components/CanvasLinks.tsx");

        expect(paramControl).toContain("hook-param-link-port");
        expect(numberControl).toContain("hook-param-slider__fill");
        expect(numberControl).not.toMatch(/violet|167,\s*139,\s*250|139,\s*92,\s*246/i);
        expect(links).toContain('stroke="var(--theme-info-text)"');
        expect(links).toContain('stroke="var(--theme-signal)"');
    });

    it("keeps shared shells and high-frequency overlays on semantic surface classes", () => {
        const themeCss = readSource("src/styles/theme-foundation.css");
        const terminalCss = readSource("src/styles/terminal-primitives.css");
        const featureCss = readSource("src/styles/feature-surfaces.css");
        const unitOverlays = [
            readSource("src/components/UnitVisualOverlays.tsx"),
            readSource("src/components/UnitEnhancementNotices.tsx"),
        ].join("\n");
        const paramsPanel = readSource("src/components/UnitParamsScrollRegion.tsx");
        const colorPicker = readSource("src/components/ColorPicker.tsx");
        const addNodeMenu = readSource("src/components/UnitAddNodeMenu.tsx");
        const topStrip = [
            readSource("src/components/StickerTopStrip.tsx"),
            readSource("src/components/StickerTopStripCreateTools.tsx"),
            readSource("src/components/StickerTopStripEditActions.tsx"),
            readSource("src/components/StickerTopStripSurfaceView.tsx"),
        ].join("\n");

        expect(themeCss).toContain("--theme-backdrop-blur: 0px;");
        expect(terminalCss).toContain("backdrop-filter: none;");
        expect(featureCss).toContain(".hook-art-error-overlay");
        expect(featureCss).toContain(".hook-param-group-header");
        expect(unitOverlays).toContain("hook-enhancement-notice");
        expect(unitOverlays).not.toContain("bg-slate-950/90");
        expect(paramsPanel).toContain("hook-param-group-header");
        expect(colorPicker).toContain("hook-color-picker__footer");
        expect(colorPicker).not.toContain("bg-slate-900");
        expect(addNodeMenu).toContain("hook-terminal-input");
        expect(addNodeMenu).not.toContain("bg-black/25");
        expect(topStrip).toContain("hook-toolbar-idle");
        expect(topStrip).not.toContain("bg-white/5");
    });
});
