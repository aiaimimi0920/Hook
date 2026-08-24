/** Shared value types for sticker geometry owners and the stable facade. */
export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export type LineEndpointHandle = "start" | "end";

export interface ShapeBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type AnnotationBounds = ShapeBox;

export interface AnnotationScale {
    x: number;
    y: number;
}
