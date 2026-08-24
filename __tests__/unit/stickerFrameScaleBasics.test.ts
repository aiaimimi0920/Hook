import { describe, expect, it } from "vitest";
import { scaleStickerEditDataForFrame } from "../../src/services/stickerEditTransforms";
import type { Unit } from "../../src/types/unit";

describe("sticker edit transforms: frame scale basics", () => {
  it("scales vector annotations and image edit overlays when a sticker frame is resized", () => {
    const sourceFrame: Pick<Unit, "w" | "h"> = { w: 100, h: 100 };
    const targetFrame: Pick<Unit, "w" | "h"> = { w: 200, h: 50 };

    const scaled = scaleStickerEditDataForFrame(
      {
        annotationState: {
          serialCounter: 1,
          elements: [
            {
              id: "rect",
              type: "rect",
              zIndex: 1,
              x: 10,
              y: 20,
              w: 30,
              h: 40,
              style: { color: "#fff", width: 4, opacity: 1, cornerRadius: 8 },
            },
            {
              id: "line",
              type: "line",
              zIndex: 2,
              points: [
                { x: 10, y: 10 },
                { x: 90, y: 80 },
              ],
              style: { color: "#fff", width: 2, opacity: 1 },
            },
          ],
        },
        imageEditState: {
          contentEraseStrokes: [
            {
              id: "erase",
              points: [
                { x: 5, y: 10 },
                { x: 50, y: 90 },
              ],
              color: "#000",
              width: 10,
              opacity: 1,
            },
          ],
          borderWidth: 6,
          borderColor: "#fff",
          cornerRadius: 12,
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
      style: { width: 5, cornerRadius: 10 },
    });
    expect(scaled.annotationState?.elements[1]).toMatchObject({
      points: [
        { x: 20, y: 5 },
        { x: 180, y: 40 },
      ],
      style: { width: 2.5 },
    });
    expect(scaled.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      points: [
        { x: 10, y: 5 },
        { x: 100, y: 45 },
      ],
      width: 12.5,
    });
    expect(scaled.imageEditState).toMatchObject({
      borderWidth: 7.5,
      borderColor: "#fff",
      cornerRadius: 15,
    });
  });

  it("does not rebuild empty edit state during an ordinary image-only resize", () => {
    const scaled = scaleStickerEditDataForFrame(
      {
        annotationState: {
          serialCounter: 1,
          elements: [],
        },
        imageEditState: {
          contentEraseStrokes: [],
        },
      },
      { w: 100, h: 80 },
      { w: 150, h: 120 },
    );

    expect(scaled).toEqual({});
  });

  it("does not create edit patches when the sticker frame size is unchanged", () => {
    const scaled = scaleStickerEditDataForFrame(
      {
        annotationState: {
          serialCounter: 1,
          elements: [
            {
              id: "rect",
              type: "rect",
              zIndex: 1,
              x: 10,
              y: 10,
              w: 20,
              h: 20,
              style: { color: "#fff", width: 2, opacity: 1 },
            },
          ],
        },
      },
      { w: 100, h: 80 },
      { w: 100, h: 80 },
    );

    expect(scaled).toEqual({});
  });

});
