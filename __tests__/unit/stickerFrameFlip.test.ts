import { afterEach, describe, expect, it, vi } from "vitest";
import { flipStickerEditDataForFrame } from "../../src/services/stickerEditTransforms";
import type { Unit } from "../../src/types/unit";

describe("sticker edit transforms: frame flip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mirrors annotations and image edit overlays with readable text when flipping a cropped sticker", () => {
    vi.stubGlobal("document", {
      createElement: (tagName: string) => {
        expect(tagName).toBe("canvas");
        return {
          getContext: () => ({
            font: "",
            measureText: () => ({ width: 30 }),
          }),
        };
      },
    });

    const frame: Pick<Unit, "w" | "h"> = { w: 200, h: 120 };

    const flippedX = flipStickerEditDataForFrame(
      {
        annotationState: {
          serialCounter: 3,
          elements: [
            {
              id: "rect",
              type: "rect",
              zIndex: 1,
              x: 20,
              y: 30,
              w: 40,
              h: 10,
              style: { color: "#fff", width: 2, opacity: 1 },
            },
            {
              id: "line",
              type: "line",
              zIndex: 2,
              points: [
                { x: 10, y: 15 },
                { x: 50, y: 25 },
              ],
              style: { color: "#fff", width: 2, opacity: 1 },
            },
            {
              id: "text",
              type: "text",
              zIndex: 3,
              x: 10,
              y: 12,
              text: "AB",
              fontSize: 20,
              style: { color: "#fff", width: 1, opacity: 1 },
            },
            {
              id: "serial",
              type: "serial",
              zIndex: 4,
              x: 40,
              y: 50,
              text: "8",
              fontSize: 18,
              style: { color: "#fff", width: 2, opacity: 1, fill: "#000", cornerRadius: 16 },
            },
          ],
        },
        imageEditState: {
          contentEraseStrokes: [
            {
              id: "erase",
              color: "#000",
              opacity: 1,
              width: 12,
              points: [
                { x: 20, y: 30 },
                { x: 60, y: 35 },
              ],
            },
          ],
          borderWidth: 4,
          borderColor: "#fff",
          cornerRadius: 12,
          flippedX: false,
          flippedY: false,
        },
      },
      frame,
      "x",
    );

    expect(flippedX.annotationState?.elements).toMatchObject([
      { id: "rect", x: 140, y: 30, w: 40, h: 10 },
      {
        id: "line",
        points: [
          { x: 190, y: 15 },
          { x: 150, y: 25 },
        ],
      },
      { id: "text", x: 160, y: 12, fontSize: 20, text: "AB" },
      { id: "serial", x: 128, y: 50, fontSize: 18, text: "8" },
    ]);
    expect(flippedX.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      points: [
        { x: 180, y: 30 },
        { x: 140, y: 35 },
      ],
    });
    expect(flippedX.imageEditState).toMatchObject({
      borderWidth: 4,
      borderColor: "#fff",
      cornerRadius: 12,
      flippedX: false,
      flippedY: false,
    });

    const flippedY = flipStickerEditDataForFrame(
      {
        annotationState: flippedX.annotationState,
        imageEditState: flippedX.imageEditState,
      },
      frame,
      "y",
    );

    expect(flippedY.annotationState?.elements).toMatchObject([
      { id: "rect", x: 140, y: 80, w: 40, h: 10 },
      {
        id: "line",
        points: [
          { x: 190, y: 105 },
          { x: 150, y: 95 },
        ],
      },
      { id: "text", x: 160, y: 128, fontSize: 20, text: "AB" },
      { id: "serial", x: 128, y: 88, fontSize: 18, text: "8" },
    ]);
    expect(flippedY.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      points: [
        { x: 180, y: 90 },
        { x: 140, y: 85 },
      ],
    });
  });

});
