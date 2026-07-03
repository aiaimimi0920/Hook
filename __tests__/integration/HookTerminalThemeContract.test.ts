import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("hook terminal theme contract", () => {
    it("defines the Neuro yellow-green terminal tokens instead of the old lavender theme", () => {
        const css = readSource("src/app.css");

        expect(css).toContain("--theme-signal: #d9ff38;");
        expect(css).toContain("--theme-success: #22c55e;");
        expect(css).toContain("--theme-panel: rgba(11, 14, 18, 0.92);");
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
        const paramsPanel = readSource("src/components/UnitParamsPanel.tsx");

        expect(actionsBar).not.toContain("bg-blue-500");
        expect(actionsBar).not.toContain("shadow-[0_0_10px");
        expect(addNodeMenu).not.toContain("rounded-[16px]");
        expect(addNodeMenu).not.toContain("#B1B2FF");
        expect(addNodeMenu).not.toContain("#AAC4FF");
        expect(paramsPanel).not.toContain("bg-blue-500");
        expect(paramsPanel).not.toContain('"border-radius": "var(--radius-lg)"');
    });

    it("replaces cyan-selected editing chrome with signal-yellow terminal classes", () => {
        const topStrip = readSource("src/components/StickerTopStrip.tsx");
        const propertyBar = readSource("src/components/StickerTopStripPropertyBar.tsx");

        expect(topStrip).toContain("hook-toolbar-button--active");
        expect(topStrip).toContain("hook-toolbar-menu-item--active");
        expect(topStrip).not.toContain("bg-cyan-500/20");
        expect(propertyBar).toContain("hook-mini-toggle--active");
        expect(propertyBar).toContain("hook-mini-switch--active");
        expect(propertyBar).not.toContain("border-cyan-400");
    });
});
