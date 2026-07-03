import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy Hook shortcut migration contract", () => {
  it("keeps Shift+1 scoped to the selected unit actions menu", () => {
    const shortcutSource = readFileSync(resolve(process.cwd(), "src", "services", "shortcuts.ts"), "utf8");
    const hooksSource = readFileSync(resolve(process.cwd(), "src", "hooks", "useShortcuts.ts"), "utf8");
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(shortcutSource).toMatch(
      /id:\s*['"]toggle-actions['"][\s\S]*?key:\s*['"]!['"][\s\S]*?modifiers:\s*\[\s*['"]shift['"]\s*\][\s\S]*?context:\s*['"]unit-selected['"]/,
    );
    expect(shortcutSource).not.toContain("open-global-add-node-menu");
    expect(shortcutSource).not.toContain("close-global-add-node-menu");
    expect(hooksSource).not.toContain("onOpenGlobalAddNodeMenu");
    expect(hooksSource).not.toContain("onCloseGlobalAddNodeMenu");
    expect(appSource).not.toContain("onOpenGlobalAddNodeMenu");
    expect(appSource).not.toContain("onCloseGlobalAddNodeMenu");
    expect(appSource).not.toContain('"global-add-node-menu"');
  });

  it("does not register Shift+1 as a desktop global shortcut", () => {
    const backendSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");

    expect(backendSource).not.toContain("Shortcut::new(Some(Modifiers::SHIFT), Code::Digit1)");
    expect(backendSource).not.toContain("shortcut.matches(Modifiers::SHIFT, Code::Digit1)");
    expect(backendSource).not.toContain("register_shift1_success");
    expect(backendSource).not.toContain("Global Shortcut Shift+1 Triggered");
    expect(backendSource).not.toContain("trigger-open-global-add-node-menu");
  });
});
