import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readOtterLibRustSources } from "../helpers/otterLibRustSources";

const tauriConfig = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
);
const rustSource = readOtterLibRustSources();
const readmeSource = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
const architectureSource = readFileSync(
    resolve(process.cwd(), "TECHNICAL_ARCHITECTURE.md"),
    "utf8",
);

describe("Otter public identity contract", () => {
    it("does not rename third-party dependency identities with the product", () => {
        const lock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"));
        expect(lock.name).toBe("otter");
        expect(lock.packages[""].name).toBe("otter");
        expect(lock.packages["node_modules/hookified"].resolved).toContain("/hookified/-/hookified-");
        expect(lock.packages["node_modules/qified/node_modules/hookified"].resolved).toContain("/hookified/-/hookified-");
        expect(JSON.stringify(lock)).not.toContain("otterified");
    });

    it("uses Otter in brand assets, internal styles, and private DOM event names", () => {
        const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
        expect(read("docs/assets/github-home-hero.svg")).toContain(">Otter</text>");
        expect(read("docs/assets/github-home-hero.svg")).not.toContain(">Hook</text>");
        for (const path of [
            "src/styles/feature-surfaces.css",
            "src/components/UnitPorts.tsx",
            "src/components/UnitParamsPortRows.tsx",
            "src/components/UnitParamsCandidateResults.tsx",
        ]) {
            expect(read(path)).not.toMatch(/hook-panel-(?:caption|port)/);
            expect(read(path)).toMatch(/otter-panel-(?:caption|port)/);
        }
        for (const path of [
            "src/services/syncService.ts", "src/app.tsx",
            "src/services/overlaySyntheticTypes.ts", "src/services/editableFocus.ts",
            "src/services/appPointerListeners.ts",
            "src/components/unitNativeStickerDragController.ts",
        ]) {
            expect(read(path)).not.toContain('"hook:');
            expect(read(path)).toContain('"otter:');
        }
    });

    it("preserves the Tauri data identity while displaying the Otter product name", () => {
        expect(tauriConfig.identifier).toBe("com.yamiyu.hook");
        expect(tauriConfig.productName).toBe("Otter");
    });

    it("uses only the current app-data identity unless an explicit override is configured", () => {
        expect(rustSource).not.toContain("LEGACY_TAURI_IDENTIFIERS");
        expect(rustSource).not.toContain("legacy_app_data_dirs_from_current");
        expect(rustSource).toContain("fn resolve_effective_app_data_dir");
        expect(rustSource).toContain("fn effective_app_data_dir");
        expect(rustSource).toContain('const APP_DATA_OVERRIDE_ENV: &str = "HOOK_APPDATA_DIR";');
    });

    it("documents the current public bundle identity without obsolete app-data paths", () => {
        expect(readmeSource).toContain("com.yamiyu.hook");
        expect(architectureSource).toContain("com.yamiyu.hook");
        expect(readmeSource).toContain("yamiyu");
    });
});
