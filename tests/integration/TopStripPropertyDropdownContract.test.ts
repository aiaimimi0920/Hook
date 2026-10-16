import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("top strip property dropdown contract", () => {
  it("uses Otter-owned popup menus instead of native select popups so options that extend into sticker space still stay inside the protected overlay input model", () => {
    const propertyBarSource = readSource("src/features/stickers/components/StickerTopStripPropertyBar.tsx");
    const fieldsSource = readSource("src/features/stickers/components/stickerTopStripPropertyBarFields.tsx");
    const dropdownSource = readSource("src/features/stickers/components/stickerTopStripPropertyDropdownController.tsx");

    expect(propertyBarSource).toContain("createStickerTopStripPropertyBarFields({");
    expect(fieldsSource).toContain("const MiniDropdownField");
    expect(fieldsSource).toContain("data-top-strip-popup-trigger={fieldProps.id}");
    expect(dropdownSource).toContain('data-top-strip-menu="true"');
    expect(dropdownSource).toContain("addOrUpdateRect(");
    expect(dropdownSource).toContain("removeRect(");
    expect(fieldsSource).toContain("toggleDropdownMenu(");
    expect(propertyBarSource).not.toContain("<select");
  });

  it("keeps the property dropdown protected after the portal ref mounts and keeps wheel input inside the font list", () => {
    const dropdownSource = readSource("src/features/stickers/components/stickerTopStripPropertyDropdownController.tsx");

    expect(dropdownSource).toContain("const syncOpenDropdownRect = (");
    expect(dropdownSource).toContain("ref={(element) => {");
    expect(dropdownSource).toContain("openDropdownMenuRef = element;");
    expect(dropdownSource).toContain("syncOpenDropdownRect(menu(), dropdownRectId(), element);");
    expect(dropdownSource).toContain("scheduleDropdownRectSync");
    expect(dropdownSource).toContain("pointer-events-auto fixed z-[1305]");
    expect(dropdownSource).toContain("onWheel={(event) => event.stopPropagation()}");
    expect(dropdownSource).toContain("onPointerMove={(event) => event.stopPropagation()}");
  });

  it("registers top strip popup menus as their own interactive rect outside the toolbar row", () => {
    const topStripSource = readSource("src/features/stickers/components/StickerTopStrip.tsx");
    const editActionsSource = readSource("src/features/stickers/components/StickerTopStripEditActions.tsx");
    const chromeSource = readSource("src/features/stickers/components/stickerTopStripChrome.ts");

    const menuPositionSource = readSource("src/features/stickers/components/stickerTopStripMenuPosition.ts");
    expect(menuPositionSource).toContain('name: "STICKER_TOP_STRIP_MENU"');
    expect(menuPositionSource).toContain("export const syncOpenToolbarMenuRect = (");
    expect(menuPositionSource).toContain("querySelector<HTMLElement>");
    expect(topStripSource).toContain("syncOpenToolbarMenuRect(menu, menuRectId, stripElement)");
    expect(topStripSource).toContain("const scheduleOpenToolbarMenuRectSync = (");
    expect(topStripSource).toContain("removeRect(openMenuRectId());");
    expect(chromeSource).toContain("otter-toolbar-menu pointer-events-auto");
    expect(editActionsSource).toContain("onWheel={(event) => event.stopPropagation()}");
    expect(editActionsSource).toContain("onPointerMove={(event) => event.stopPropagation()}");
  });

  it("keeps history as independent actions and rasterize preference selectable even when execution is unavailable", () => {
    const topStripSource = readSource("src/features/stickers/components/StickerTopStrip.tsx");
    const editActionsSource = readSource("src/features/stickers/components/StickerTopStripEditActions.tsx");
    expect(editActionsSource).toContain('disabled={item.mode === "undo" ? !props.canUndo : !props.canRedo}');
    expect(editActionsSource).toContain("props.onHistoryAction(item.mode)");
    expect(editActionsSource).not.toContain('props.openMenu === "history"');
    const rasterizeMenuBlock = sourceBetween(
      editActionsSource,
      '<Show when={props.openMenu === "rasterize"}>',
      "</For>",
    );

    expect(rasterizeMenuBlock).not.toContain("disabled={");
    expect(rasterizeMenuBlock).toContain("props.onSelectRasterizeScope(item.mode)");
    expect(topStripSource).toContain("setCurrentRasterizeScope(scope);");
  });
});
