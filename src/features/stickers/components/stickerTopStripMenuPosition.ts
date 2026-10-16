import { addOrUpdateRect } from "../../../platform/desktop/uiRegistry";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { clamp } from "../../../shared/geometry/math";

/** Keep primary-strip menus in the viewport before publishing native hit rectangles. */
export const syncOpenToolbarMenuRect = (
    menu: string | null,
    menuRectId: string,
    stripElement: HTMLDivElement | undefined,
) => {
    if (!menu || !stripElement) return false;
    const element = stripElement.querySelector<HTMLElement>("[data-top-strip-menu='true']");
    const anchor = element?.offsetParent;
    if (!element || !(anchor instanceof HTMLElement)) return false;

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = Math.min(4, viewportWidth / 4, viewportHeight / 4);
    const availableWidth = Math.max(1, viewportWidth - margin * 2);
    const availableHeight = Math.max(1, viewportHeight - margin * 2);
    element.style.maxWidth = `${availableWidth}px`;
    element.style.minWidth = availableWidth < 96 ? `${availableWidth}px` : "";
    element.style.maxHeight = `${availableHeight}px`;
    element.style.marginTop = "0px";
    element.style.overflow = "visible";
    // Long extension menus remain reachable on small displays; scrolling clips the pointer.
    const scrolls = element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
    element.style.overflow = scrolls ? "auto" : "visible";
    element.classList.toggle("otter-toolbar-menu--scroll", scrolls);

    const anchorBounds = anchor.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    const left = clamp(anchorBounds.left, margin, Math.max(margin, viewportWidth - size.width - margin));
    const belowTop = anchorBounds.bottom + 12;
    const aboveTop = anchorBounds.top - size.height - 12;
    const opensAbove = belowTop + size.height > viewportHeight - margin && aboveTop >= margin;
    const top = clamp(opensAbove ? aboveTop : belowTop, margin, Math.max(margin, viewportHeight - size.height - margin));
    element.style.left = `${left - anchorBounds.left}px`;
    element.style.top = `${top - anchorBounds.top}px`;
    element.classList.toggle("otter-toolbar-menu--above", opensAbove);
    const pointerX = clamp(anchorBounds.left + anchorBounds.width / 2 - left - 1, 8, Math.max(8, size.width - 10));
    element.style.setProperty("--edit-strip-menu-pointer-x", `${pointerX}px`);

    const bounds = element.getBoundingClientRect();
    addOrUpdateRect({
        id: menuRectId,
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
        name: "STICKER_TOP_STRIP_MENU",
    });
    syncTopStripBackendRects();
    return true;
};
