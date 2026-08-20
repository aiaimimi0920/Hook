import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("native window focus contract", () => {
  it("propagates native focus changes without a focus-gain restore path", () => {
    const rustSource = readFileSync(resolve(repoRoot, "src-tauri/src/lib.rs"), "utf8");
    const appSource = readFileSync(resolve(repoRoot, "src/app.tsx"), "utf8");

    expect(rustSource).toContain('window.label() == "main"');
    expect(rustSource).toContain("WindowEvent::Focused(focused)");
    expect(rustSource).toContain('window.emit("hook/window_focus_changed", *focused)');
    expect(appSource).toContain('listen<boolean>("hook/window_focus_changed"');
    expect(appSource).toContain("notifyNativeAppFocus(event.payload);");
    expect(appSource).not.toContain("releaseEditableFocus");
    expect(appSource).not.toMatch(/event\.payload\s*===\s*true[^}]*focus\(/s);
  });
});
