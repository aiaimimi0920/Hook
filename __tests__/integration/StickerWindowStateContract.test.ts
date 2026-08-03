import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const actionsSource = readFileSync(resolve(process.cwd(), "src/hooks/useUnitActions.ts"), "utf8");
const graphStoreSource = readFileSync(resolve(process.cwd(), "src/store/graphStore.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker window-state contract", () => {
    it("updates minified sticker geometry and metadata through one store write so the shrunken sticker never renders an intermediate frame", () => {
        expect(graphStoreSource).toContain("const updateStickerWindowState = (");
        expect(graphStoreSource).toContain("setUnits(match, (previous) => ({");
        expect(graphStoreSource).toContain("...frame,");
        expect(graphStoreSource).toContain("...previous.data,");
        expect(graphStoreSource).toContain("...dataUpdates,");
        expect(actionsSource).toContain("graphStore.actions.updateStickerWindowState(");
        expect(actionsSource).not.toContain("graphStore.actions.updateUnitData(id, { \n              minified: true");
        expect(actionsSource).not.toContain("graphStore.actions.updateUnit(id, {\n              x: newX");
        expect(unitViewSource).toContain('import { graphStore } from "../store/graphStore";');
        expect(unitViewSource).toContain("const liveUnit = () => props.unit;");
        expect(unitViewSource).toContain("const unit = liveUnit();");
        expect(unitViewSource).toContain("width: `${unit.w}px`");
    });
});
