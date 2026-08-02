import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const rustNaming = readSource("src-tauri/src/file_naming.rs");
const rustEntry = readSource("src-tauri/src/lib.rs");
const dragService = readSource("src/services/unitDragExport.ts");
const unitView = readSource("src/components/UnitView.tsx");
const clipboard = readSource("src/hooks/useClipboard.ts");

describe("Hook unified file naming contract", () => {
    it("uses Rust as the final filename authority with atomic collision allocation", () => {
        expect(rustNaming).toContain("OpenOptions::new().write(true).create_new(true)");
        expect(rustNaming).toContain('format!("_{index}")');
        expect(rustNaming).toContain("MAX_FILENAME_STEM_CHARS.saturating_sub");
        expect(rustNaming).toContain("sanitize_windows_filename_stem");
        expect(rustNaming).toContain("MAX_FILENAME_STEM_CHARS: usize = 120");
        expect(rustNaming).toContain('"CON" | "PRN" | "AUX" | "NUL"');
        expect(rustNaming).not.toContain("if !candidate.exists()");
    });

    it("routes every user-visible backend output through a configured naming pattern", () => {
        expect(rustEntry.match(/FileNamingPatternKind::StickerSave/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(rustEntry.match(/FileNamingPatternKind::DragExport/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
        expect(rustEntry.match(/FileNamingPatternKind::ClipboardFile/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(rustEntry).toContain("create_unique_file(&saved_dir");
        expect(rustEntry).toContain("create_unique_file(&target_dir");
        expect(rustEntry).toContain("create_unique_file(&cache_dir");
        expect(rustEntry).toContain("default_filename = format!(\"{stem}.png\")");
    });

    it("passes structured unit metadata instead of deleting Unicode labels in TypeScript", () => {
        expect(dragService).toContain("buildUnitFileNamingContext");
        expect(dragService).toContain("fileNamingContext");
        expect(dragService).not.toContain("/[^a-z0-9]/g");
        expect(unitView).toContain("exportPlan.fileNamingContext");
        expect(unitView).toContain("appSettings.fileNaming.dragExportPattern");
        expect(clipboard).toContain("buildUnitFileNamingContext(unit)");
    });
});
