import { addOrUpdateRect, removeRect, updatePortOffset } from "../../../platform/desktop/uiRegistry";
import type { Unit } from "../types/unit";
import { createPropertyGroupBackdrops } from "./unitPropertyGroupBackdrop";

/** Register actual visible controls, never the transparent area covering the image. */
export function observeUnitTabGeometry(root: HTMLElement, getUnit: () => Unit) {
    let frame: number | undefined;
    let disposed = false;
    const ids = new Set<string>();
    const backdrops = createPropertyGroupBackdrops(root);
    const measure = () => {
        frame = undefined;
        if (disposed || !root.isConnected) return;
        const unit = getUnit();
        const host = root.closest<HTMLElement>(".unit-container");
        if (!host) return;
        const base = host.getBoundingClientRect();
        const scale = unit.w > 0 ? base.width / unit.w : 1;
        if (!(scale > 0)) return;
        backdrops.update(scale);
        const next = new Set<string>();
        root.querySelectorAll<HTMLElement>("[data-tab-hit-region]").forEach((element, index) => {
            const box = element.getBoundingClientRect();
            if (!box.width || !box.height || element.closest('[inert], .is-port-hidden')) return;
            const clip = element.closest<HTMLElement>(".param-scroll-container");
            const clipBox = clip?.getBoundingClientRect();
            const top = Math.max(box.top, clipBox?.top ?? box.top);
            const bottom = Math.min(box.bottom, clipBox?.bottom ?? box.bottom);
            if (bottom <= top) return;
            const id = `tab-${unit.id}-${index}`;
            next.add(id);
            addOrUpdateRect({ id, name: "PARAMS_PANEL", x: unit.x + (box.left - base.left) / scale,
                y: unit.y + (top - base.top) / scale, width: box.width / scale, height: (bottom - top) / scale });
        });
        ids.forEach(id => { if (!next.has(id)) removeRect(id); });
        ids.clear();
        next.forEach(id => ids.add(id));
        root.querySelectorAll<HTMLElement>("[data-panel-port]").forEach(element => {
            const box = element.getBoundingClientRect();
            if (!box.width || !box.height) return;
            const name = element.dataset.portName;
            if (name) updatePortOffset(unit.id, name, {
                x: box.left + box.width / 2 - base.left,
                y: box.top + box.height / 2 - base.top,
            });
        });
    };
    const schedule = () => { if (!disposed && frame === undefined) frame = requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    const observeChildren = () => {
        resize?.disconnect();
        resize?.observe(root);
        root.querySelectorAll<HTMLElement>("[data-tab-hit-region]").forEach(element => resize?.observe(element));
        schedule();
    };
    const mutation = new MutationObserver(observeChildren);
    mutation.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "inert", "aria-expanded"] });
    root.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    observeChildren();
    return { refresh: schedule, dispose: () => {
        disposed = true;
        if (frame !== undefined) cancelAnimationFrame(frame);
        mutation.disconnect();
        resize?.disconnect();
        root.removeEventListener("scroll", schedule, true);
        backdrops.dispose();
        window.removeEventListener("resize", schedule);
        ids.forEach(id => removeRect(id));
        ids.clear();
    } };
}
