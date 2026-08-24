import { describe, expect, it } from "vitest";
import {
  annotationContainsPoint,
  findTopmostAnnotationAtPoint,
} from "../../src/services/stickerGeometry";
import type { StickerAnnotation } from "../../src/types/stickerEditing";

describe("sticker edit transforms: geometry hit testing", () => {
  it("hit-tests triangle and polygon annotations so transform tools can pick them", () => {
    const triangle: StickerAnnotation = {
      id: "triangle",
      type: "triangle",
      zIndex: 1,
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      style: { color: "#fff", width: 2, opacity: 1, fill: "#ffffff" },
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
      style: { color: "#fff", width: 2, opacity: 1, fill: "#ffffff" },
    };

    expect(annotationContainsPoint(triangle, { x: 25, y: 45 })).toBe(true);
    expect(annotationContainsPoint(polygon, { x: 62, y: 72 })).toBe(true);
    expect(findTopmostAnnotationAtPoint([triangle, polygon], { x: 62, y: 72 })?.id).toBe("polygon");
  });

  it("hit-tests rotated box annotations using their transformed geometry", () => {
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

    expect(annotationContainsPoint(rotatedRect, { x: 30, y: 10 })).toBe(true);
    expect(findTopmostAnnotationAtPoint([rotatedRect], { x: 30, y: 10 })?.id).toBe("rotated-rect");
    expect(annotationContainsPoint(rotatedRect, { x: 5, y: 25 }, 0)).toBe(false);
  });
});
