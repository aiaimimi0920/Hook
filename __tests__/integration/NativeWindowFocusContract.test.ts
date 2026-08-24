import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("native window focus contract", () => {
  it("propagates native focus changes without a focus-gain restore path", () => {
    const rustSource = readHookLibRustSources();
    const appSource = readFileSync(resolve(repoRoot, "src/app.tsx"), "utf8");
    const commandSource = readFileSync(
      resolve(repoRoot, "src/services/appCommandListeners.ts"),
      "utf8",
    );

    expect(rustSource).toContain('window.label() == "main"');
    expect(rustSource).toContain("WindowEvent::Focused(focused)");
    expect(rustSource).toContain('window.emit("hook/window_focus_changed", *focused)');
    expect(appSource).toContain("registerAppCommandListeners");
    expect(commandSource).toContain('listen<boolean>("hook/window_focus_changed"');
    expect(commandSource).toContain("notifyNativeAppFocus(event.payload);");
    expect(commandSource).not.toContain("releaseEditableFocus");
    expect(commandSource).not.toMatch(/event\.payload\s*===\s*true[^}]*focus\(/s);
  });
});
