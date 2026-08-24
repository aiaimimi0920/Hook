import { describe, expect, it } from "vitest";
import { scaleStickerEditDataForFrame } from "../../src/services/stickerEditTransforms";
import type { Unit } from "../../src/types/unit";

describe("sticker edit transforms: shape and effect scale", () => {
  it("scales brush-style effect annotations, including stroke points, brush width, and strength, when a sticker frame is resized", () => {
    const sourceFrame: Pick<Unit, "w" | "h"> = { w: 100, h: 100 };
    const targetFrame: Pick<Unit, "w" | "h"> = { w: 200, h: 50 };

    const scaled = scaleStickerEditDataForFrame(
      {
        annotationState: {
          serialCounter: 1,
          elements: [
            {
              id: "mosaic-effect",
              type: "mosaic",
              zIndex: 1,
              x: 10,
              y: 20,
              w: 30,
              h: 40,
              points: [
                { x: 12, y: 24 },
                { x: 28, y: 32 },
                { x: 36, y: 52 },
              ],
              brushWidth: 12,
              strength: 10,
              style: {
                color: "#ffffff",
                width: 0,
                opacity: 1,
                fill: "#000000",
                secondaryFill: "#ffffff",
              },
            },
          ],
        },
      },
      sourceFrame,
      targetFrame,
    );

    expect(scaled.annotationState?.elements[0]).toMatchObject({
      x: 20,
      y: 10,
      w: 60,
      h: 20,
      points: [
        { x: 24, y: 12 },
        { x: 56, y: 16 },
        { x: 72, y: 26 },
      ],
      brushWidth: 15,
      strength: 12.5,
    });
  });

  it("scales triangle and polygon annotations when a sticker frame is resized", () => {
    const sourceFrame: Pick<Unit, "w" | "h"> = { w: 100, h: 100 };
    const targetFrame: Pick<Unit, "w" | "h"> = { w: 200, h: 50 };

    const scaled = scaleStickerEditDataForFrame(
      {
        annotationState: {
          serialCounter: 1,
          elements: [
            {
              id: "triangle",
              type: "triangle",
              zIndex: 1,
              x: 10,
              y: 20,
              w: 30,
              h: 40,
              style: { color: "#fff", width: 4, opacity: 1 },
            },
            {
              id: "polygon",
              type: "polygon",
              zIndex: 2,
              x: 50,
              y: 60,
              w: 20,
              h: 20,
              sides: 6,
              style: { color: "#fff", width: 2, opacity: 1, fill: "transparent" },
            },
          ],
        },
      },
      sourceFrame,
      targetFrame,
    );

    expect(scaled.annotationState?.elements[0]).toMatchObject({
      id: "triangle",
      x: 20,
      y: 10,
      w: 60,
      h: 20,
      style: { width: 5 },
    });
    expect(scaled.annotationState?.elements[1]).toMatchObject({
      id: "polygon",
      x: 100,
      y: 30,
      w: 40,
      h: 10,
      sides: 6,
      style: { width: 2.5, fill: "transparent" },
    });
  });

});
