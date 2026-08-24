import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("unit selection visual stability", () => {
  it("uses only outward overlays for both the 1px idle frame and 2px selected frame so the content area stays pixel-exact", () => {
    const unitViewPath = path.resolve(process.cwd(), "src/components/UnitView.tsx");
    const unitOverlaysPath = path.resolve(process.cwd(), "src/components/UnitVisualOverlays.tsx");
    const appCssPath = path.resolve(process.cwd(), "src/styles/unit-workspace.css");
    const source = fs.readFileSync(unitViewPath, "utf8");
    const overlaySource = fs.readFileSync(unitOverlaysPath, "utf8");
    const appCss = fs.readFileSync(appCssPath, "utf8");

    expect(source).toContain('"border": "none"');
    expect(overlaySource).toContain('class="selection-border"');
    expect(source).toContain('!isMinified() && !isCleanView()');
    expect(source).toContain("const showSelectionBorder = () => true;");
    expect(source).not.toContain("const hasSelectedAnnotationInActiveSticker = () =>");
    expect(overlaySource).toMatch(/inset:\s*props\.isSelected\s*\?\s*"-2px"\s*:\s*"-1px"/);
    expect(overlaySource).toMatch(/border:\s*props\.isSelected\s*\?\s*"2px solid white"\s*:\s*`1px solid rgba\(255,255,255,\$\{Math\.max\(0\.2, props\.opacity\)\}\)`/s);
    expect(source).toMatch(/<Show when=\{!isMinified\(\) && !isCleanView\(\)\}>[\s\S]*?<UnitSelectionBorder/);

    expect(appCss).toContain('pointer-events: none;');
    expect(appCss).not.toContain('box-shadow: 0 0 10px rgba(0,0,0,0.5);');
    expect(appCss).not.toContain('inset: -1px;');
    expect(appCss).not.toContain('border: 1px solid white;');
  });
});
