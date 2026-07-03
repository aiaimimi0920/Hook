import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const actionsSource = readFileSync(resolve(process.cwd(), "src/hooks/useUnitActions.ts"), "utf8");
const graphStoreSource = readFileSync(resolve(process.cwd(), "src/store/graphStore.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker window-state contract", () => {
    it("updates minified sticker geometry and metadata through direct store field writes plus one data merge so the shrunken sticker does not render at the stale top-left position", () => {
        expect(graphStoreSource).toContain("const updateStickerWindowState = (");
        expect(graphStoreSource).toContain('setUnits(match, "x", () => frame.x);');
        expect(graphStoreSource).toContain('setUnits(match, "y", () => frame.y);');
        expect(graphStoreSource).toContain('setUnits(match, "w", () => frame.w);');
        expect(graphStoreSource).toContain('setUnits(match, "h", () => frame.h);');
        expect(graphStoreSource).toContain('setUnits(match, "data", (prev) => ({');
        expect(actionsSource).toContain("graphStore.actions.updateStickerWindowState(");
        expect(actionsSource).not.toContain("graphStore.actions.updateUnitData(id, { \n              minified: true");
        expect(actionsSource).not.toContain("graphStore.actions.updateUnit(id, {\n              x: newX");
        expect(unitViewSource).toContain('import { graphStore } from "../store/graphStore";');
        expect(unitViewSource).toContain("const liveUnit = () => graphStore.units.find((unit) => unit.id === props.unit.id) || props.unit;");
        expect(unitViewSource).toContain("const unit = liveUnit();");
        expect(unitViewSource).toContain("width: `${unit.w}px`");
    });
});
