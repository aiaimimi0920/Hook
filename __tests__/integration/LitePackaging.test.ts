import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Hook Lite packaging", () => {
  it("does not copy local OCR assets or DirectML into the default Hook release package", () => {
    const scriptPath = path.resolve(process.cwd(), "build-hook-release.bat");
    const source = fs.readFileSync(scriptPath, "utf8");

    expect(source).not.toContain("DirectML.dll");
    expect(source).not.toContain("resources\\ocr");
  });
});
