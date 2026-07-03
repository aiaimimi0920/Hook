import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("unit selection visual stability", () => {
  it("uses only outward overlays for both the 1px idle frame and 2px selected frame so the content area stays pixel-exact", () => {
    const unitViewPath = path.resolve(process.cwd(), "src/components/UnitView.tsx");
    const appCssPath = path.resolve(process.cwd(), "src/app.css");
    const source = fs.readFileSync(unitViewPath, "utf8");
    const appCss = fs.readFileSync(appCssPath, "utf8");

    expect(source).toContain('"border": "none"');
    expect(source).toContain('class="selection-border"');
    expect(source).toContain('!isMinified() && !isCleanView()');
    expect(source).toContain("const showSelectionBorder = () => true;");
    expect(source).not.toContain("const hasSelectedAnnotationInActiveSticker = () =>");
    expect(source).toMatch(/inset:\s*props\.isSelected\s*\?\s*"-2px"\s*:\s*"-1px"/);
    expect(source).toMatch(/border:\s*props\.isSelected\s*\?\s*"2px solid white"\s*:\s*`1px solid rgba\(255,255,255,\$\{Math\.max\(0\.2, getOpacity\(\)\)\}\)`/s);
    expect(source).toMatch(/<\/div>\s*<Show when=\{!isMinified\(\) && !isCleanView\(\)\}>/s);

    expect(appCss).toContain('pointer-events: none;');
    expect(appCss).not.toContain('box-shadow: 0 0 10px rgba(0,0,0,0.5);');
    expect(appCss).not.toContain('inset: -1px;');
    expect(appCss).not.toContain('border: 1px solid white;');
  });
});
