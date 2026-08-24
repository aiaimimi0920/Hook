import type { Unit } from "../../src/types/unit";

/** Build the standard image-through sticker used by graph resolver tests. */
export const sticker = (id: string, data: Unit["data"]): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params: {},
    inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
    outputs: [{ id: "output", type: "image", direction: "output", label: "Image" }],
    data,
});
