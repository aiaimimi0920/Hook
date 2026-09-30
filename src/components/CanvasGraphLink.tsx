import { Component, createMemo, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import { isCleanView, layoutTick, multiDragPositions, unitUiState } from "../store/uiStore";
import { portOffsets } from "../services/uiRegistry";
import { calculatePortY } from "../utils/graphUtils";
import type { Link, Unit } from "../types/unit";

type LinkPaths = { body: string | null; dashed: string | null };

const curve = (x1: number, y1: number, x2: number, y2: number) =>
    `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;

// One owner per link keeps SVG nodes mounted while their coordinates change.
// All geometry dependencies remain tracked, including committed unit edits.
export const CanvasGraphLink: Component<{
    link: Link | undefined;
    unitById: ReadonlyMap<string, Unit>;
}> = (props) => {
    const paths = createMemo<LinkPaths>(() => {
        const link = props.link;
        const source = link && props.unitById.get(link.fromUnitId);
        const target = link && props.unitById.get(link.toUnitId);
        if (!link || !source || !target) return { body: null, dashed: null };

        layoutTick();
        const dragPositions = multiDragPositions();
        const fromX = dragPositions?.[source.id]?.x ?? source.x;
        const fromY = dragPositions?.[source.id]?.y ?? source.y;
        const toX = dragPositions?.[target.id]?.x ?? target.x;
        const toY = dragPositions?.[target.id]?.y ?? target.y;
        const capabilities = graphStore.capabilities;
        const bodyX1 = fromX + source.w + (source.data.minified ? 4 : 6);
        const bodyX2 = toX - (target.data.minified ? 4 : 6);
        const bodyY1 = calculatePortY(source, link.fromPortId, false, capabilities, fromY);
        const bodyY2 = calculatePortY(target, link.toPortId, true, capabilities, toY);
        const cleanView = isCleanView();
        const showFrom = unitUiState[source.id]?.showParams && !source.data.minified;
        const showTo = unitUiState[target.id]?.showParams && !target.data.minified;
        const showDashed = cleanView ? (showFrom && showTo) : (showFrom || showTo);
        const offsets = portOffsets();
        const fromPort = showFrom ? offsets[source.id]?.[link.fromPortId] : undefined;
        const toPort = showTo ? offsets[target.id]?.[link.toPortId] : undefined;

        return {
            body: cleanView ? null : curve(bodyX1, bodyY1, bodyX2, bodyY2),
            dashed: showDashed ? curve(
                fromPort ? fromX + fromPort.x : bodyX1,
                fromPort ? fromY + fromPort.y : bodyY1,
                toPort ? toX + toPort.x : bodyX2,
                toPort ? toY + toPort.y : bodyY2,
            ) : null,
        };
    }, { body: null, dashed: null }, {
        // Global drag samples also notify unrelated links. Avoid downstream DOM
        // work for those links without keeping a cache beyond the owner's life.
        equals: (left, right) => left.body === right.body && left.dashed === right.dashed,
    });

    return (
        <>
            <Show when={paths().body}>
                <path
                    d={paths().body!}
                    fill="none"
                    stroke="var(--theme-text-muted)"
                    stroke-width="2"
                    stroke-dasharray="none"
                    marker-end="url(#arrowhead)"
                />
            </Show>
            <Show when={paths().dashed}>
                <path
                    d={paths().dashed!}
                    fill="none"
                    stroke="var(--theme-text-muted)"
                    stroke-width="2"
                    stroke-dasharray="5,5"
                    marker-end="url(#arrowhead)"
                />
            </Show>
        </>
    );
};
