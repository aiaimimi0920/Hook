import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Hook voice panel visibility contract", () => {
  it("does not render the voice and Tea debug panel as a fixed top-right desktop overlay by default", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).not.toContain('data-testid="voice-status-panel"');
    expect(appSource).not.toContain("fixed right-4 top-4");
    expect(appSource).not.toContain("voice-status-footnote");
    expect(appSource).not.toContain("Rust-owned state machine");
    expect(appSource).not.toContain("Last output:");
  });
});
