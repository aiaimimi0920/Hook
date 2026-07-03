import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import {
  flipStickerEditDataForFrame,
  scaleStickerEditDataForFrame,
} from "../../src/services/stickerEditTransforms";
import {
  annotationContainsPoint,
  cloneStickerAnnotation,
  findTopmostAnnotationAtPoint,
  getAnnotationCenter,
  getAnnotationGroupCenter,
  rotateAnnotationsAroundGroupCenter,
  rotateAnnotationsAroundOwnCenters,
  scaleAnnotationsAroundGroupCenter,
  scaleAnnotationsAroundOwnCenters,
  translateAnnotation,
} from "../../src/services/stickerGeometry";
import type { StickerAnnotation } from "../../src/types/stickerEditing";
import type { Unit } from "../../src/types/unit";

describe("sticker edit transforms", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      { id: "text", x: 160, y: 88, fontSize: 20, text: "AB" },
      { id: "serial", x: 128, y: 88, fontSize: 18, text: "8" },
    ]);
    expect(flippedY.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      points: [
        { x: 180, y: 90 },
        { x: 140, y: 85 },
      ],
    });
  });

  it("clones store-backed annotations before transform interactions snapshot their baseline", () => {
    const [state] = createStore<{ elements: StickerAnnotation[] }>({
      elements: [
        {
          id: "rect",
          type: "rect",
          zIndex: 1,
          x: 10,
          y: 20,
          w: 30,
          h: 40,
          style: { color: "#fff", width: 2, opacity: 1, fill: "transparent" },
        },
      ],
    });

    const cloned = cloneStickerAnnotation(state.elements[0]);
    expect(cloned).toEqual({
      id: "rect",
      type: "rect",
      zIndex: 1,
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      style: { color: "#fff", width: 2, opacity: 1, fill: "transparent" },
    });
    expect(cloned).not.toBe(state.elements[0]);

    cloned.x = 99;
    expect(state.elements[0].x).toBe(10);
  });

  it("uses the overall group center by default for multi-annotation rotate and scale transforms", () => {
    const annotations: StickerAnnotation[] = [
      {
        id: "left",
        type: "rect",
        zIndex: 1,
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      {
        id: "right",
        type: "rect",
        zIndex: 2,
        x: 40,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
    ];

    expect(getAnnotationCenter(annotations[0])).toEqual({ x: 10, y: 10 });
    expect(getAnnotationCenter(annotations[1])).toEqual({ x: 50, y: 10 });
    expect(getAnnotationGroupCenter(annotations)).toEqual({ x: 30, y: 10 });

    const rotated = rotateAnnotationsAroundGroupCenter(annotations, 90);
    expect(getAnnotationCenter(rotated[0])).toEqual({ x: 30, y: -10 });
    expect(getAnnotationCenter(rotated[1])).toEqual({ x: 30, y: 30 });

    const scaled = scaleAnnotationsAroundGroupCenter(annotations, { x: 2, y: 2 });
    expect(getAnnotationCenter(scaled[0])).toEqual({ x: -10, y: 10 });
    expect(getAnnotationCenter(scaled[1])).toEqual({ x: 70, y: 10 });
  });

  it("switches to per-node centers for multi-annotation rotate and scale transforms when requested", () => {
    const annotations: StickerAnnotation[] = [
      {
        id: "left",
        type: "rect",
        zIndex: 1,
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      {
        id: "right",
        type: "rect",
        zIndex: 2,
        x: 40,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
    ];

    const rotated = rotateAnnotationsAroundOwnCenters(annotations, 90);
    expect(getAnnotationCenter(rotated[0])).toEqual({ x: 10, y: 10 });
    expect(getAnnotationCenter(rotated[1])).toEqual({ x: 50, y: 10 });

    const scaled = scaleAnnotationsAroundOwnCenters(annotations, { x: 2, y: 2 });
    expect(getAnnotationCenter(scaled[0])).toEqual({ x: 10, y: 10 });
    expect(getAnnotationCenter(scaled[1])).toEqual({ x: 50, y: 10 });
    expect(scaled[0]).toMatchObject({ x: -10, y: -10, w: 40, h: 40 });
    expect(scaled[1]).toMatchObject({ x: 30, y: -10, w: 40, h: 40 });
  });

  it("rotates brush-style effect annotations as a whole, including stroke points and bounds", () => {
    const annotations: StickerAnnotation[] = [
      {
        id: "effect",
        type: "mosaic",
        zIndex: 1,
        x: 10,
        y: 10,
        w: 40,
        h: 20,
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
        ],
        brushWidth: 10,
        strength: 12,
        style: {
          color: "#fff",
          width: 0,
          opacity: 1,
          fill: "#000",
          secondaryFill: "#fff",
        },
      },
    ];

    const rotated = rotateAnnotationsAroundOwnCenters(annotations, 90);
    expect(rotated[0]).toMatchObject({
      x: 25,
      y: 5,
      w: 10,
      h: 30,
      points: [
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    });
  });

  it("translates triangle and polygon annotations when move transforms are applied", () => {
    const triangle = translateAnnotation(
      {
        id: "triangle",
        type: "triangle",
        zIndex: 1,
        x: 10,
        y: 20,
        w: 30,
        h: 40,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      12,
      -6,
    );

    const polygon = translateAnnotation(
      {
        id: "polygon",
        type: "polygon",
        zIndex: 2,
        x: 50,
        y: 60,
        w: 20,
        h: 20,
        sides: 6,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      -8,
      14,
    );

    expect(triangle).toMatchObject({ x: 22, y: 14, w: 30, h: 40 });
    expect(polygon).toMatchObject({ x: 42, y: 74, w: 20, h: 20, sides: 6 });
  });

  it("hit-tests triangle and polygon annotations so transform tools can pick them", () => {
    const triangle: StickerAnnotation = {
      id: "triangle",
      type: "triangle",
      zIndex: 1,
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      style: { color: "#fff", width: 2, opacity: 1 },
    };

    const polygon: StickerAnnotation = {
      id: "polygon",
      type: "polygon",
      zIndex: 2,
      x: 50,
      y: 60,
      w: 24,
      h: 24,
      sides: 6,
      style: { color: "#fff", width: 2, opacity: 1 },
    };

    expect(annotationContainsPoint(triangle, { x: 25, y: 45 })).toBe(true);
    expect(annotationContainsPoint(polygon, { x: 62, y: 72 })).toBe(true);
    expect(findTopmostAnnotationAtPoint([triangle, polygon], { x: 62, y: 72 })?.id).toBe("polygon");
  });

  it("hit-tests rotated box annotations using their transformed bounds", () => {
    const rotatedRect: StickerAnnotation = {
      id: "rotated-rect",
      type: "rect",
      zIndex: 1,
      x: 0,
      y: 0,
      w: 40,
      h: 20,
      rotation: 90,
      style: { color: "#fff", width: 2, opacity: 1 },
    };

    expect(annotationContainsPoint(rotatedRect, { x: 15, y: 25 })).toBe(true);
    expect(findTopmostAnnotationAtPoint([rotatedRect], { x: 15, y: 25 })?.id).toBe("rotated-rect");
  });
});
