// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createPropertyGroupBackdrops, propertyBackdropGroups } from "../../src/features/workspace/components/unitPropertyGroupBackdrop";

describe("adjacent property backdrops", () => {
    it("groups consecutive expanded rows but excludes singletons and collapsed gaps", () => {
        const rows = [true, true, false, true, true, true, false, true].map((expanded, index) => ({ expanded, top: index * 36, bottom: index * 36 + 28 }));
        expect(propertyBackdropGroups(rows)).toEqual([{ top: 0, bottom: 64 }, { top: 108, bottom: 208 }]);
        expect(propertyBackdropGroups([{ expanded: true, top: 0, bottom: 0 }, { expanded: true, top: 36, bottom: 64 }])).toEqual([]);
    });

    it("bridges nested row groups, respects scrolling clips and removes obsolete backing blocks", () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="unit-tab-rail"><div><div class="unit-property-capsule is-expanded"></div></div><div class="param-scroll-container"><div class="unit-property-capsule is-expanded"></div></div></div>';
        const rail = root.querySelector<HTMLElement>(".unit-tab-rail")!;
        const rows = root.querySelectorAll<HTMLElement>(".unit-property-capsule");
        vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
        vi.spyOn(rows[0], "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 156, width: 512 } as DOMRect);
        vi.spyOn(rows[1], "getBoundingClientRect").mockReturnValue({ top: 172, bottom: 228, width: 512 } as DOMRect);
        vi.spyOn(root.querySelector(".param-scroll-container")!, "getBoundingClientRect").mockReturnValue({ top: 172, bottom: 212 } as DOMRect);
        const backdrops = createPropertyGroupBackdrops(root);
        backdrops.update(2);
        const block = root.querySelector<HTMLElement>(".unit-property-group-backdrops > div")!;
        expect(block.style.top).toBe("0px"); expect(block.style.height).toBe("56px");
        expect(block.hasAttribute("data-tab-hit-region")).toBe(false);
        backdrops.update(2);
        expect(root.querySelector(".unit-property-group-backdrops > div")).toBe(block);
        rows[1].classList.remove("is-expanded"); backdrops.update(2);
        expect(root.querySelector(".unit-property-group-backdrops")?.children).toHaveLength(0);
        backdrops.dispose(); expect(root.querySelector(".unit-property-group-backdrops")).toBeNull();
    });
});
