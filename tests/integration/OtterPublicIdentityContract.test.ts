import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readOtterLibRustSources } from "../helpers/otterLibRustSources";

const tauriConfig = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
);
const rustSource = readOtterLibRustSources();
const readmeSource = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
const packagesSource = readFileSync(resolve(process.cwd(), "docs/guide/packages.md"), "utf8");
const packagesZhSource = readFileSync(resolve(process.cwd(), "docs/guide/packages.zh-CN.md"), "utf8");
const architectureSource = readFileSync(
    resolve(process.cwd(), "docs/architecture/overview.md"),
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
            "src/shared/styles/feature-surfaces.css",
            "src/features/art/components/UnitPorts.tsx",
            "src/features/art/components/UnitParamsPortRows.tsx",
            "src/features/art/components/UnitParamsCandidateResults.tsx",
        ]) {
            expect(read(path)).not.toMatch(/hook-panel-(?:caption|port)/);
        }
        expect(read("src/shared/styles/feature-surfaces.css")).toMatch(/otter-panel-(?:caption|port)/);
        expect(read("src/features/art/components/UnitParamsCandidateResults.tsx")).toContain("otter-panel-caption");
        expect(read("src/features/art/components/UnitPorts.tsx")).toContain("unit-property-node-port");
        expect(read("src/features/art/components/UnitParamsPortRows.tsx")).toContain("UnitPropertyCapsule");
        for (const path of [
            "src/features/workspace/services/syncService.ts", "src/app/app.tsx",
            "src/platform/desktop/overlaySyntheticTypes.ts", "src/platform/desktop/editableFocus.ts",
            "src/app/appPointerListeners.ts",
            "src/features/workspace/components/unitNativeStickerDragController.ts",
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
        expect(readmeSource).toContain("./docs/README.md");
        expect(packagesSource).toContain("com.yamiyu.hook");
        expect(packagesZhSource).toContain("com.yamiyu.hook");
        expect(architectureSource).toContain("com.yamiyu.hook");
        expect(packagesSource).toContain("yamiyu");
    });
});
