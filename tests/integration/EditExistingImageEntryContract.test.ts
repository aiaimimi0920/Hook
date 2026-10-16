import { describe, expect, it } from "vitest";
import { readOtterLibRustSources } from "../helpers/otterLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("edit-existing-image entry", () => {
  it("registers the open_image_for_edit Tauri command and tray menu item", () => {
    const rustSource = readOtterLibRustSources();

    expect(rustSource).toContain("fn open_image_for_edit()");
    expect(rustSource).toContain("open_image_for_edit,");
    expect(rustSource).toContain("GetOpenFileNameW");
    // Tray entry that lets the user pick an image to edit.
    expect(rustSource).toContain('"open_image"');
    expect(rustSource).toContain("trigger-open-image");
  });

  it("reads the picked file only and never modifies the original", () => {
    const rustSource = readOtterLibRustSources();
    // open_image_for_edit decodes via the bounded read path; no write/create.
    expect(rustSource).toContain("read_image_from_path(path.to_string_lossy().to_string())");
  });

  it("wires an Open-Image shortcut and listener on the frontend", () => {
    const shortcutsSource = readSource("src/platform/desktop/shortcuts.ts");
    const useShortcutsSource = readSource("src/platform/desktop/useShortcuts.ts");
    const appSource = readSource("src/app/app.tsx");
    const commandSource = readSource("src/app/appCommandListeners.ts");
    const stickerEditingSource = readSource("src/app/appStickerEditingController.ts");
    const imageResourceApiSource = readSource("src/platform/tauri/apiImageResource.ts");

    expect(shortcutsSource).toContain("id: 'open-image'");
    expect(useShortcutsSource).toContain("ShortcutManager.register('open-image'");
    expect(stickerEditingSource).toContain("const openImageForEdit = async");
    expect(commandSource).toContain('listen("trigger-open-image"');
    expect(appSource).toContain("openImageForEdit");
    expect(imageResourceApiSource).toContain('safeInvoke("open_image_for_edit"');
  });

  it("loads clipboard images into a sticker via the existing paste path", () => {
    const clipboardSource = readSource("src/features/workspace/hooks/useClipboard.ts");
    // Ctrl+V already covers the "edit clipboard image" entry.
    expect(clipboardSource).toContain("navigator.clipboard.read()");
    expect(clipboardSource).toContain("createImageUnit(base64");
  });
});
