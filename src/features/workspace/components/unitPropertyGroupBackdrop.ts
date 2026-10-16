type Row = { expanded: boolean; top: number; bottom: number };
type Group = { top: number; bottom: number };

/** Only consecutive visible expanded rows share a backing surface. */
export function propertyBackdropGroups(rows: Row[]): Group[] {
    const groups: Group[] = [];
    let run: Group | undefined;
    let count = 0;
    const flush = () => {
        if (run && count > 1) groups.push(run);
        run = undefined;
        count = 0;
    };
    for (const row of rows) {
        if (!row.expanded || row.bottom <= row.top) { flush(); continue; }
        if (run && row.top < run.top) flush();
        if (!run) run = { top: row.top, bottom: row.bottom };
        else run.bottom = Math.max(run.bottom, row.bottom);
        count++;
    }
    flush();
    return groups;
}

/** Shares the existing panel geometry observer; no extra listeners or hit areas. */
export function createPropertyGroupBackdrops(root: HTMLElement) {
    const layers = new Map<HTMLElement, HTMLDivElement>();
    const update = (scale: number) => {
        for (const [rail, layer] of layers) {
            if (!root.contains(rail)) { layer.remove(); layers.delete(rail); }
        }
        root.querySelectorAll<HTMLElement>(".unit-tab-rail").forEach(rail => {
            const railBox = rail.getBoundingClientRect();
            const rows = Array.from(rail.querySelectorAll<HTMLElement>(".unit-property-capsule"), row => {
                const box = row.getBoundingClientRect();
                const clip = row.closest(".param-scroll-container")?.getBoundingClientRect();
                return {
                    expanded: row.classList.contains("is-expanded") && !row.classList.contains("is-port-hidden") && box.width > 0,
                    top: (Math.max(box.top, clip?.top ?? box.top) - railBox.top) / scale,
                    bottom: (Math.min(box.bottom, clip?.bottom ?? box.bottom) - railBox.top) / scale,
                };
            });
            const groups = propertyBackdropGroups(rows);
            let layer = layers.get(rail);
            if (!layer && !groups.length) return;
            if (!layer) {
                layer = document.createElement("div");
                layer.className = "unit-property-group-backdrops";
                layer.setAttribute("aria-hidden", "true");
                rail.prepend(layer);
                layers.set(rail, layer);
            }
            while (layer.children.length > groups.length) layer.lastElementChild?.remove();
            groups.forEach((group, index) => {
                let block = layer!.children[index] as HTMLDivElement | undefined;
                if (!block) { block = document.createElement("div"); layer!.append(block); }
                block.style.top = `${group.top}px`;
                block.style.height = `${group.bottom - group.top}px`;
            });
        });
    };
    return { update, dispose: () => { layers.forEach(layer => layer.remove()); layers.clear(); } };
}
