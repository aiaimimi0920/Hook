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
  it("uses Hook-owned popup menus instead of native select popups so options that extend into sticker space still stay inside the protected overlay input model", () => {
    const propertyBarSource = readSource("src/components/StickerTopStripPropertyBar.tsx");
    const fieldsSource = readSource("src/components/stickerTopStripPropertyBarFields.tsx");
    const dropdownSource = readSource("src/components/stickerTopStripPropertyDropdownController.tsx");

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
    const dropdownSource = readSource("src/components/stickerTopStripPropertyDropdownController.tsx");

    expect(dropdownSource).toContain("const syncOpenDropdownRect = (");
    expect(dropdownSource).toContain("ref={(element) => {");
    expect(dropdownSource).toContain("openDropdownMenuRef = element;");
    expect(dropdownSource).toContain("syncOpenDropdownRect(menu(), dropdownRectId(), element);");
    expect(dropdownSource).toContain("scheduleDropdownRectSync");
    expect(dropdownSource).toContain("pointer-events-auto fixed z-[1305]");
    expect(dropdownSource).toContain("onWheel={(event) => event.stopPropagation()}");
    expect(dropdownSource).toContain("onPointerMove={(event) => event.stopPropagation()}");
  });

  it("registers the top strip history and rasterize popup menus as their own interactive rect so their options can be selected outside the toolbar row", () => {
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");
    const editActionsSource = readSource("src/components/StickerTopStripEditActions.tsx");
    const chromeSource = readSource("src/components/stickerTopStripChrome.ts");

    expect(topStripSource).toContain('name: "STICKER_TOP_STRIP_MENU"');
    expect(topStripSource).toContain("const syncOpenToolbarMenuRect = (");
    expect(topStripSource).toContain('querySelector<HTMLElement>("[data-top-strip-menu=\'true\']")');
    expect(topStripSource).toContain("const scheduleOpenToolbarMenuRectSync = (");
    expect(topStripSource).toContain("removeRect(openMenuRectId());");
    expect(chromeSource).toContain("hook-toolbar-menu pointer-events-auto");
    expect(editActionsSource).toContain("onWheel={(event) => event.stopPropagation()}");
    expect(editActionsSource).toContain("onPointerMove={(event) => event.stopPropagation()}");
  });

  it("lets history and rasterize dropdown options select the preferred action even when that action is not currently executable", () => {
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");
    const editActionsSource = readSource("src/components/StickerTopStripEditActions.tsx");
    const historyMenuBlock = sourceBetween(
      editActionsSource,
      '<Show when={props.openMenu === "history"}>',
      '<Show when={props.supportsBitmapTools}>',
    );
    const rasterizeMenuBlock = sourceBetween(
      editActionsSource,
      '<Show when={props.openMenu === "rasterize"}>',
      "        </>",
    );

    expect(historyMenuBlock).not.toContain("disabled={!enabled}");
    expect(rasterizeMenuBlock).not.toContain("disabled={!enabled}");
    expect(historyMenuBlock).toContain("props.onSelectHistoryAction(item.mode)");
    expect(rasterizeMenuBlock).toContain("props.onSelectRasterizeScope(item.mode)");
    expect(topStripSource).toContain("setCurrentHistoryAction(mode);");
    expect(topStripSource).toContain("setCurrentRasterizeScope(scope);");
  });
});
