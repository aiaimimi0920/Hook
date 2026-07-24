import { Component, createMemo, For, Show } from "solid-js";
import { graphStore } from "../store/graphStore";
import {
    linkingState,
    mousePos,
    hoveringLink,
    selectedStickerId,
    multiDragPositions,
    unitUiState,
    layoutTick,
    isCleanView
} from "../store/uiStore";
import { portOffsets } from "../services/uiRegistry";
import { calculatePortY } from "../utils/graphUtils";

type LinkRenderPath = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    dashed: boolean;
    color: string;
};

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

export const CanvasLinks: Component = () => {
    // Computations
    const renderPaths = createMemo(() => {
        // Dependency: Force re-calc on layout tick
        layoutTick();

        const list = graphStore.units;
        const currentLinks = graphStore.links;
        const capabilities = graphStore.capabilities; // For port calculation
        const dPositions = multiDragPositions();

        return currentLinks.flatMap(link => {
             const sFrom = list.find(s => s.id === link.fromUnitId);
             const sTo = list.find(s => s.id === link.toUnitId);

             if (!sFrom || !sTo) return [];

             const paths: LinkRenderPath[] = [];

             // TRANSIENT DRAG STATE OVERRIDE
             const currFrom = (dPositions && dPositions[sFrom.id])
                 ? { ...sFrom, x: dPositions[sFrom.id].x, y: dPositions[sFrom.id].y }
                 : sFrom;

             const currTo = (dPositions && dPositions[sTo.id])
                 ? { ...sTo, x: dPositions[sTo.id].x, y: dPositions[sTo.id].y }
                 : sTo;

             // --- 1. BODY LINK (Solid) ---
             // Always calculated from Body Ports
             const bodyY1 = calculatePortY(currFrom, link.fromPortId, false, capabilities);
             const bodyY2 = calculatePortY(currTo, link.toPortId, true, capabilities);
             const bodyX1 = currFrom.x + currFrom.w + (currFrom.data.minified ? 4 : 6);
             const bodyX2 = currTo.x - (currTo.data.minified ? 4 : 6);

             // Rule: Body Link exists in Normal View, Hidden in Clean View
             if (!isCleanView()) {
                 paths.push({
                     x1: bodyX1, y1: bodyY1, x2: bodyX2, y2: bodyY2,
                     dashed: false, color: "#9CA3AF"
                 });
             }

             // --- 2. PANEL LINK (Dashed) ---
             // Helper to get Panel Port Positions
             const getPanelPortPos = (uId: string, portName: string, uX: number, uY: number) => {
                 // Try Registry (Fast)
                 const allOffsets = portOffsets();
                 const uOff = allOffsets[uId];
                 if (uOff && uOff[portName]) {
                     return { x: uX + uOff[portName].x, y: uY + uOff[portName].y };
                 }
                 return null;
             };

             // Check if "Panel" is actually visible (Params enabled AND Not Minified)
             const showFrom = unitUiState[currFrom.id]?.showParams && !currFrom.data.minified;
             const showTo = unitUiState[currTo.id]?.showParams && !currTo.data.minified;

             // Determine Effective Endpoints for the Dashed Line
             // If panel is open -> use panel coords. If closed -> fallback to body coords.
             let pX1 = bodyX1, pY1 = bodyY1;
             let pX2 = bodyX2, pY2 = bodyY2;

             if (showFrom) {
                 const p1 = getPanelPortPos(sFrom.id, link.fromPortId, currFrom.x, currFrom.y);
                 if (p1) { pX1 = p1.x; pY1 = p1.y; }
             }
             if (showTo) {
                 const p2 = getPanelPortPos(sTo.id, link.toPortId, currTo.x, currTo.y);
                 if (p2) { pX2 = p2.x; pY2 = p2.y; }
             }

             // Rule: Visibility of Dashed Link
             // - Clean View: visible ONLY if BOTH ends are Panels
             // - Normal View: visible if AT LEAST ONE end is a Panel
             const showDashed = isCleanView()
                 ? (showFrom && showTo)
                 : (showFrom || showTo);

             if (showDashed) {
                 paths.push({
                     x1: pX1, y1: pY1, x2: pX2, y2: pY2,
                     dashed: true, color: "#9CA3AF"
                 });
             }

             return paths;
        });
    });

    const selectedOverlayLinks = createMemo<OverlayLinkHighlight[]>(() => {
        if (isCleanView()) {
            return [];
        }

        const id = selectedStickerId();
        if (!id) {
            return [];
        }

        const source = graphStore.units.find((unit) => unit.id === id);
        if (!source) {
            return [];
        }

        const params = graphStore.unitParams[id] ?? {};
        return Object.values(params)
            .filter((value): value is string => typeof value === "string" && value.length > 0 && !value.startsWith("data:"))
            .map((targetId) => graphStore.units.find((unit) => unit.id === targetId))
            .filter((target): target is NonNullable<typeof target> => !!target)
            .map((target) => ({
                source: {
                    x: source.x,
                    y: source.y,
                    w: source.w,
                    h: source.h,
                },
                target: {
                    x: target.x,
                    y: target.y,
                    w: target.w,
                    h: target.h,
                },
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

        const source = graphStore.units.find((unit) => unit.id === sourceUnitId);
        const target = graphStore.units.find((unit) => unit.id === targetUnitId);
        if (!source || !target) {
            return null;
        }

        return {
            source: {
                x: source.x,
                y: source.y,
                w: source.w,
                h: source.h,
            },
            target: {
                x: target.x,
                y: target.y,
                w: target.w,
                h: target.h,
            },
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
                <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
            </marker>
        </defs>

        {/* DRAG LINKING PREVIEW */}
        <Show when={linkingState().isLinking}>
             <path
                d={`M ${linkingState().startX} ${linkingState().startY} C ${linkingState().startX + 50} ${linkingState().startY}, ${mousePos().x - 50} ${mousePos().y}, ${mousePos().x} ${mousePos().y}`}
                fill="none"
                stroke="#AAC4FF"
                stroke-width="2"
                stroke-dasharray="5,5"
                marker-end="url(#arrowhead)"
             />
        </Show>

        {/* EXISTING LINKS */}
        <For each={renderPaths()}>
            {(coords) => (
                <path
                    d={`M ${coords.x1} ${coords.y1} C ${coords.x1 + 50} ${coords.y1}, ${coords.x2 - 50} ${coords.y2}, ${coords.x2} ${coords.y2}`}
                    fill="none"
                    stroke={coords.color}
                    stroke-width="2"
                    stroke-dasharray={coords.dashed ? "5,5" : "none"}
                    marker-end="url(#arrowhead)"
                />
            )}
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
                        stroke="#FEF08A"
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
                        stroke="#FEF08A"
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
                        stroke="#FACC15"
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
                        stroke="#FACC15"
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
