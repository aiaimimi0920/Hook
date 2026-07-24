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

    expect(propertyBarSource).toContain("const MiniDropdownField");
    expect(propertyBarSource).toContain('data-top-strip-menu="true"');
    expect(propertyBarSource).toContain("addOrUpdateRect(");
    expect(propertyBarSource).toContain("removeRect(");
    expect(propertyBarSource).not.toContain("<select");
  });

  it("keeps the property dropdown protected after the portal ref mounts and keeps wheel input inside the font list", () => {
    const propertyBarSource = readSource("src/components/StickerTopStripPropertyBar.tsx");

    expect(propertyBarSource).toContain("const syncOpenDropdownRect = (");
    expect(propertyBarSource).toContain("ref={(element) => {");
    expect(propertyBarSource).toContain("openDropdownMenuRef = element;");
    expect(propertyBarSource).toContain("syncOpenDropdownRect(menu(), dropdownRectId(), element);");
    expect(propertyBarSource).toContain("scheduleDropdownRectSync");
    expect(propertyBarSource).toContain("pointer-events-auto fixed z-[1305]");
    expect(propertyBarSource).toContain("onWheel={(event) => event.stopPropagation()}");
    expect(propertyBarSource).toContain("onPointerMove={(event) => event.stopPropagation()}");
  });

  it("registers the top strip history and rasterize popup menus as their own interactive rect so their options can be selected outside the toolbar row", () => {
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");

    expect(topStripSource).toContain('name: "STICKER_TOP_STRIP_MENU"');
    expect(topStripSource).toContain("const syncOpenToolbarMenuRect = (");
    expect(topStripSource).toContain('querySelector<HTMLElement>("[data-top-strip-menu=\'true\']")');
    expect(topStripSource).toContain("const scheduleOpenToolbarMenuRectSync = (");
    expect(topStripSource).toContain("removeRect(openMenuRectId());");
    expect(topStripSource).toContain("hook-toolbar-menu pointer-events-auto");
    expect(topStripSource).toContain("onWheel={(event) => event.stopPropagation()}");
    expect(topStripSource).toContain("onPointerMove={(event) => event.stopPropagation()}");
  });

  it("lets history and rasterize dropdown options select the preferred action even when that action is not currently executable", () => {
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");
    const historyMenuBlock = sourceBetween(
      topStripSource,
      '<Show when={openMenu() === "history"}>',
      '<div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>',
    );
    const rasterizeMenuBlock = sourceBetween(
      topStripSource,
      '<Show when={openMenu() === "rasterize"}>',
      "</Portal>",
    );

    expect(historyMenuBlock).not.toContain("disabled={!enabled}");
    expect(rasterizeMenuBlock).not.toContain("disabled={!enabled}");
    expect(historyMenuBlock).toContain("setCurrentHistoryAction(item.mode);");
    expect(rasterizeMenuBlock).toContain("setCurrentRasterizeScope(item.mode);");
  });
});
