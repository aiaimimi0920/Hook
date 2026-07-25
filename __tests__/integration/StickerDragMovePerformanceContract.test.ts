import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("sticker drag move performance contract", () => {
  it("throttles drag-position commits through a frame scheduler instead of mutating drag positions on every raw mousemove", () => {
    const dragSource = readSource("src/hooks/useDraggable.ts");
    const handleDragMoveBlock = sourceBetween(
      dragSource,
      "const handleDragMove = (e: MouseEvent) => {",
      "const handleDragEnd = async () => {",
    );

    expect(dragSource).toContain("const scheduleDragMoveFrame = () => {");
    expect(dragSource).toContain("window.requestAnimationFrame");
    expect(handleDragMoveBlock).toContain("scheduleDragMoveFrame();");
    expect(handleDragMoveBlock).not.toContain("setMultiDragPositions(nextPositions);");
  });

  it("skips unrelated global mouse position churn while a sticker drag is active", () => {
    const appSource = readSource("src/app.tsx");
    const handleGlobalMouseMoveBlock = sourceBetween(
      appSource,
      "const handleGlobalMouseMove = (e: MouseEvent) => {",
      "const handleGlobalMouseUp = (e: MouseEvent) => {",
    );

    expect(handleGlobalMouseMoveBlock).toContain("if (!draggingStickerId()) {");
    expect(handleGlobalMouseMoveBlock).toContain("setMousePos({ x: e.clientX, y: e.clientY });");
  });

  it("does not wake every UnitView on drag start by making currentPos depend on draggingStickerId alone", () => {
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const currentPosBlock = sourceBetween(
      unitViewSource,
      "const currentPos = () => {",
      "const style = () => {",
    );

    expect(currentPosBlock).toContain("if (props.multiDragPositions && props.multiDragPositions[props.unit.id]) {");
    expect(currentPosBlock).not.toContain("draggingStickerId()");
  });

  it("batches drag-start selection and toolbar state updates into one reactive flush", () => {
    const appSource = readSource("src/app.tsx");
    const mouseDownBlock = sourceBetween(
      appSource,
      "const onStartDragUnit = (e: MouseEvent, id: string) => {",
      "const resolveUnitImage = (id: string, visited = new Set<string>()): string | undefined => {",
    );
    const uiStoreSource = readSource("src/store/uiStore.ts");

    expect(mouseDownBlock).toContain("batch(() => {");
    expect(mouseDownBlock).toContain("startDrag(e, id");
    expect(uiStoreSource).toContain("showStickerToolbar: (unitId: string) => {");
    expect(uiStoreSource).toContain("hideStickerToolbar: () => {");
    expect(uiStoreSource).toContain("selectionActions = {");
    expect(uiStoreSource).toContain("batch(() => {");
  });
});
