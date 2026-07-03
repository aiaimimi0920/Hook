import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook AHRP cloud output contract", () => {
  it("accepts ArtLoom base64 output at data.output.data when shared memory is unavailable", () => {
    const source = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(source).toMatch(/json\["data"\]\s*\["output"\]\s*\.as_object\(\)/);
    expect(source).toMatch(/output\["data"\]\s*\.as_str\(\)/);
    expect(source).toContain("Successfully received base64 output from ArtLoom");
  });

  it("turns ArtLoom engine errors into failed deliveries instead of returning the original image", () => {
    const source = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(source).toContain("fn emit_art_error");
    expect(source).toContain("extract_artloom_error_message");
    expect(source).toMatch(/ArtLoom returned error:[\s\S]*emit_art_error[\s\S]*return;/);
  });

  it("surfaces failed art deliveries on the node instead of leaving the old preview silently visible", () => {
    const protocolSource = readFileSync(resolve(process.cwd(), "src", "services", "protocol.ts"), "utf8");
    const unitTypeSource = readFileSync(resolve(process.cwd(), "src", "types", "unit.ts"), "utf8");
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
    const unitViewSource = readFileSync(resolve(process.cwd(), "src", "components", "UnitView.tsx"), "utf8");

    expect(protocolSource).toContain("error?: string");
    expect(unitTypeSource).toContain("errorMessage?: string");
    expect(appSource).toMatch(/nodeStatus:\s*"error"[\s\S]*errorMessage:\s*delivery\.error/);
    expect(appSource).toMatch(/nodeStatus:\s*"completed"[\s\S]*errorMessage:\s*undefined/);
    expect(unitViewSource).toContain("执行失败");
    expect(unitViewSource).toContain("errorMessage");
  });
});
