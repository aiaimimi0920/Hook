import { Component, createMemo, For, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import {
    linkingState,
    mousePos,
    hoveringLink,
    selectedStickerId,
    multiDragPositions,
    isCleanView
} from "../store/uiStore";
import { CanvasGraphLink } from "./CanvasGraphLink";
import type { Unit } from "../types/unit";

type OverlayLinkHighlight = {
    source: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    target: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
};

const resolveUnitOverlayRect = (
    unit: Unit,
    dragPositions: ReturnType<typeof multiDragPositions>,
) => {
    const dragPosition = dragPositions?.[unit.id];
    return {
        x: dragPosition?.x ?? unit.x,
        y: dragPosition?.y ?? unit.y,
        w: unit.w,
        h: unit.h,
    };
};

export const CanvasLinks: Component = () => {
    const unitById = createMemo(
        () => new Map(graphStore.units.map((unit) => [unit.id, unit])),
    );

    // IDs survive coordinate changes, graph reorder, and same-ID replacements.
    // The lookup tracks topology only; each mounted link owns reactive geometry.
    const linkById = createMemo(
        () => new Map(graphStore.links.map((link) => [link.id, link])),
    );

    const selectedOverlayLinks = createMemo<OverlayLinkHighlight[]>(() => {
        if (isCleanView()) {
            return [];
        }

        const id = selectedStickerId();
        if (!id) {
            return [];
        }

        const currentUnitById = unitById();
        const source = currentUnitById.get(id);
        if (!source) {
            return [];
        }

        const dPositions = multiDragPositions();
        const sourceRect = resolveUnitOverlayRect(source, dPositions);
        const params = graphStore.unitParams[id] ?? {};
        return Object.values(params)
            .filter((value): value is string => typeof value === "string" && value.length > 0 && !value.startsWith("data:"))
            .map((targetId) => currentUnitById.get(targetId))
            .filter((target): target is NonNullable<typeof target> => !!target)
            .map((target) => ({
                source: sourceRect,
                target: resolveUnitOverlayRect(target, dPositions),
            }));
    });

    const hoverPreviewLink = createMemo<OverlayLinkHighlight | null>(() => {
        if (isCleanView()) {
            return null;
        }

        const { sourceUnitId, targetUnitId } = hoveringLink();
        if (!sourceUnitId || !targetUnitId) {
            return null;
        }

        const currentUnitById = unitById();
        const source = currentUnitById.get(sourceUnitId);
        const target = currentUnitById.get(targetUnitId);
        if (!source || !target) {
            return null;
        }

        const dPositions = multiDragPositions();
        return {
            source: resolveUnitOverlayRect(source, dPositions),
            target: resolveUnitOverlayRect(target, dPositions),
        };
    });

    return (
      <svg
        class="absolute inset-0 pointer-events-none z-[60] overflow-visible"
        width="100%"
        height="100%"
      >
        <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="var(--theme-text-muted)" />
            </marker>
        </defs>

        {/* DRAG LINKING PREVIEW */}
        <Show when={linkingState().isLinking}>
             <path
                d={`M ${linkingState().startX} ${linkingState().startY} C ${linkingState().startX + 50} ${linkingState().startY}, ${mousePos().x - 50} ${mousePos().y}, ${mousePos().x} ${mousePos().y}`}
                fill="none"
                stroke="var(--theme-info-text)"
                stroke-width="2"
                stroke-dasharray="5,5"
                marker-end="url(#arrowhead)"
             />
        </Show>

        {/* EXISTING LINKS */}
        <For each={[...linkById().keys()]}>
            {(id) => <CanvasGraphLink link={linkById().get(id)} unitById={unitById()} />}
        </For>

        {/* SELECTED UNIT LINKS OVERLAY */}
        {/* Only show in Normal View to avoid clutter in Clean View */}
        <For each={selectedOverlayLinks()}>
            {(link) => (
                <>
                    <line
                        x1={link.source.x + link.source.w / 2}
                        y1={link.source.y + link.source.h / 2}
                        x2={link.target.x + link.target.w / 2}
                        y2={link.target.y + link.target.h / 2}
                        stroke="var(--theme-signal)"
                        stroke-width="1.5"
                        stroke-dasharray="4,4"
                        opacity="0.5"
                    />
                    <rect
                        x={link.target.x - 2}
                        y={link.target.y - 2}
                        width={link.target.w + 4}
                        height={link.target.h + 4}
                        fill="none"
                        stroke="var(--theme-signal)"
                        stroke-width="1.5"
                        stroke-dasharray="4,4"
                        rx="6"
                        opacity="0.5"
                    />
                </>
            )}
        </For>

        {/* HOVERING LINK PREVIEW */}
        <Show when={hoverPreviewLink()}>
            {(link) => (
                <>
                     <path
                        d={`M ${link().source.x + link().source.w / 2} ${link().source.y + link().source.h / 2} C ${link().source.x + link().source.w / 2 + 50} ${link().source.y + link().source.h / 2}, ${link().target.x + link().target.w / 2 - 50} ${link().target.y + link().target.h / 2}, ${link().target.x + link().target.w / 2} ${link().target.y + link().target.h / 2}`}
                        fill="none"
                        stroke="var(--theme-signal)"
                        stroke-width="2"
                        stroke-dasharray="8,4"
                        class="animate-pulse"
                    />
                    <rect
                        x={link().target.x - 4}
                        y={link().target.y - 4}
                        width={link().target.w + 8}
                        height={link().target.h + 8}
                        fill="none"
                        stroke="var(--theme-signal)"
                        stroke-width="2"
                        stroke-dasharray="8,4"
                        rx="8"
                        class="animate-pulse"
                    />
                </>
            )}
        </Show>
      </svg>
    );
};
