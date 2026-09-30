import type { JSX } from "solid-js";

import type { SurfaceNode } from "../services/surfaceProtocol";

type SurfaceProps = Record<string, unknown>;

const asRecord = (value: unknown): SurfaceProps =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as SurfaceProps
        : {};

const MAX_SURFACE_PIXEL_LENGTH = 8_192;
const MAX_SURFACE_RELATIVE_LENGTH = 1_000;
const SAFE_CONTAINER_MINIMUM = /^min\((\d+(?:\.\d+)?)(cqw|cqh),\s*(\d+(?:\.\d+)?)(cqw|cqh)\)$/;
const SAFE_BOUNDED_POSITION = /^min\((\d+(?:\.\d+)?)%,\s*calc\(100%\s*-\s*min\((\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)px\)\)\)$/;
const SAFE_OFFSET_BOUNDED_POSITION = /^min\(calc\((\d+(?:\.\d+)?)%\s*\+\s*(\d+(?:\.\d+)?)px\),\s*calc\(100%\s*-\s*min\((\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)px\)\)\)$/;

export const safeSurfaceCssLength = (value: unknown): string | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value >= 0 && value <= MAX_SURFACE_PIXEL_LENGTH ? `${value}px` : undefined;
    }
    if (typeof value !== "string") return undefined;
    const length = value.trim();
    if (length === "auto" || length === "0") return length;
    const minimum = SAFE_CONTAINER_MINIMUM.exec(length);
    if (minimum) {
        const first = Number(minimum[1]);
        const second = Number(minimum[3]);
        return Number.isFinite(first)
            && Number.isFinite(second)
            && first <= MAX_SURFACE_RELATIVE_LENGTH
            && second <= MAX_SURFACE_RELATIVE_LENGTH
            ? length
            : undefined;
    }
    const boundedPosition = SAFE_BOUNDED_POSITION.exec(length);
    if (boundedPosition) {
        const values = boundedPosition.slice(1).map(Number);
        return values.every((entry) => Number.isFinite(entry))
            && values[0] <= 100
            && values[1] <= 100
            && values[2] <= MAX_SURFACE_PIXEL_LENGTH
            ? length
            : undefined;
    }
    const offsetBoundedPosition = SAFE_OFFSET_BOUNDED_POSITION.exec(length);
    if (offsetBoundedPosition) {
        const values = offsetBoundedPosition.slice(1).map(Number);
        return values.every((entry) => Number.isFinite(entry))
            && values[0] <= 100
            && values[1] <= MAX_SURFACE_PIXEL_LENGTH
            && values[2] <= 100
            && values[3] <= MAX_SURFACE_PIXEL_LENGTH
            ? length
            : undefined;
    }
    const match = /^(\d+(?:\.\d+)?)(px|%|rem|em|vw|vh|cqw|cqh|fr)$/.exec(length);
    if (!match) return undefined;
    const magnitude = Number(match[1]);
    if (!Number.isFinite(magnitude)) return undefined;
    const maximum = match[2] === "px" ? MAX_SURFACE_PIXEL_LENGTH : MAX_SURFACE_RELATIVE_LENGTH;
    return magnitude <= maximum ? length : undefined;
};

const SAFE_NAMED_COLORS = new Set([
    "black", "white", "red", "green", "blue", "gray", "grey", "yellow", "orange",
    "purple", "pink", "transparent", "currentcolor",
]);

export const safeSurfaceCssColor = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const color = value.trim();
    if (color.length === 0 || color.length > 64 || /[;{}!]|url\(|expression\(/i.test(color)) {
        return undefined;
    }
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
        return color;
    }
    if (/^(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s]+\)$/i.test(color)) return color;
    if (/^var\(--[a-z0-9-]{1,48}\)$/i.test(color)) return color;
    return SAFE_NAMED_COLORS.has(color.toLowerCase()) ? color : undefined;
};

const safeAlignment = (value: unknown): JSX.CSSProperties["align-items"] =>
    typeof value === "string" && ["stretch", "flex-start", "center", "flex-end", "baseline"].includes(value)
        ? value as JSX.CSSProperties["align-items"]
        : undefined;

const safeJustification = (value: unknown): JSX.CSSProperties["justify-content"] =>
    typeof value === "string" && [
        "flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly",
    ].includes(value)
        ? value as JSX.CSSProperties["justify-content"]
        : undefined;

const boundedNumber = (value: unknown, minimum: number, maximum: number): number | undefined =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.min(maximum, Math.max(minimum, value))
        : undefined;

/** Maps an untrusted declarative node to a bounded CSS property allow-list. */
export const surfaceNodeStyle = (node: SurfaceNode): JSX.CSSProperties => {
    const layout = asRecord(node.layout);
    const style = asRecord(node.style);
    const direction = node.type === "row" ? "row" : "column";
    const position = layout.position === "absolute" || layout.position === "relative"
        ? layout.position
        : undefined;
    return {
        display: node.type === "stack" ? "grid" : "flex",
        "flex-direction": direction,
        "align-items": safeAlignment(layout.align) ?? "stretch",
        "justify-content": safeJustification(layout.justify) ?? "flex-start",
        gap: safeSurfaceCssLength(layout.gap),
        padding: safeSurfaceCssLength(layout.padding),
        width: safeSurfaceCssLength(layout.width),
        height: safeSurfaceCssLength(layout.height),
        "min-width": safeSurfaceCssLength(layout.minWidth),
        "min-height": safeSurfaceCssLength(layout.minHeight),
        "max-width": safeSurfaceCssLength(layout.maxWidth),
        "max-height": safeSurfaceCssLength(layout.maxHeight),
        ...(position ? {
            position,
            left: safeSurfaceCssLength(layout.left),
            top: safeSurfaceCssLength(layout.top),
            right: safeSurfaceCssLength(layout.right),
            bottom: safeSurfaceCssLength(layout.bottom),
        } : {}),
        "flex-grow": boundedNumber(layout.grow, 0, 100),
        "overflow-x": layout.overflowX === "auto" || layout.overflowX === "hidden"
            ? layout.overflowX
            : undefined,
        "overflow-y": layout.overflowY === "auto" || layout.overflowY === "hidden"
            ? layout.overflowY
            : undefined,
        color: safeSurfaceCssColor(style.color),
        background: safeSurfaceCssColor(style.background),
        "border-color": safeSurfaceCssColor(style.borderColor),
        "border-width": safeSurfaceCssLength(style.borderWidth),
        "border-style": style.borderWidth === undefined ? undefined : "solid",
        "border-radius": safeSurfaceCssLength(style.borderRadius),
        opacity: boundedNumber(style.opacity, 0, 1),
        "font-size": safeSurfaceCssLength(style.fontSize),
        "line-height": safeSurfaceCssLength(style.lineHeight),
        "font-weight": boundedNumber(style.fontWeight, 100, 900),
        "white-space": typeof style.whiteSpace === "string"
            && ["normal", "nowrap", "pre", "pre-wrap"].includes(style.whiteSpace)
            ? style.whiteSpace as JSX.CSSProperties["white-space"]
            : undefined,
        "text-align": style.textAlign === "left" || style.textAlign === "center" || style.textAlign === "right"
            ? style.textAlign
            : undefined,
        "grid-area": node.type === "stack" ? "1 / 1" : undefined,
    };
};
