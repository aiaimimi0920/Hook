import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const uiStoreSource = readFileSync(resolve(process.cwd(), "src/features/workspace/state/uiStore.ts"), "utf8");

describe("Otter API chunking contract", () => {
    it("keeps uiStore history/settings persistence on a static api import instead of a dynamic import", () => {
        expect(uiStoreSource).toContain('import { api } from "../../../platform/tauri/api";');
        expect(uiStoreSource).not.toContain('await import("../../../platform/tauri/api")');
    });
});
