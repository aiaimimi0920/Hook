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

  it("moves drag followers through an imperative compositor fast path without a Solid position update", () => {
    const dragSource = readSource("src/hooks/useDraggable.ts");
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const canvasUnitsSource = readSource("src/components/CanvasUnits.tsx");
    const uiStoreSource = readSource("src/store/uiStore.ts");
    const portsSource = readSource("src/components/UnitPorts.tsx");
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");
    const addNodeMenuSource = readSource("src/components/UnitAddNodeMenu.tsx");

    expect(dragSource).toContain("getDragFollowerElements(Object.keys(dragStartPositions))");
    expect(dragSource).not.toContain("querySelectorAll");
    expect(dragSource).toContain("const applyDragVisualFastPath =");
    expect(dragSource).toContain("prepareDragVisualFastPath();");
    expect(dragSource).toContain("follower.element.style.transform = `translate3d(");
    expect(dragSource).toContain('follower.element.style.willChange = "transform";');
    expect(unitViewSource).toContain("data-hook-drag-follow-unit-id={props.unit.id}");
    expect(portsSource).toContain("data-hook-drag-follow-unit-id={props.unit.id}");
    expect(topStripSource).toContain("data-hook-drag-follow-unit-id={props.unitId}");
    expect(unitViewSource).toContain("registerDragFollowerElement(unitId, element);");
    expect(portsSource).toContain("registerDragFollowerElement(unitId, element);");
    expect(topStripSource).toContain("registerDragFollowerElement(unitId, element);");
    expect(addNodeMenuSource).toContain("registerDragFollowerElement(unitId, element);");
    expect(uiStoreSource).not.toContain("multiDragPositionStore");
    expect(canvasUnitsSource).not.toContain("dragPosition=");
    expect(canvasUnitsSource).not.toContain("multiDragPositions={multiDragPositions()}");
  });

  it("keeps committed left/top static while the fast path owns transient transform styles", () => {
    const dragSource = readSource("src/hooks/useDraggable.ts");
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const styleBlock = sourceBetween(
      unitViewSource,
      "const style = () => {",
      "const getOpacity = () =>",
    );

    expect(dragSource).toContain("applyDragVisualFastPath(nextPositions);");
    expect(dragSource).toContain("clearDragVisualFastPath();");
    expect(styleBlock).toContain("left: `${unit.x}px`");
    expect(styleBlock).toContain("top: `${unit.y}px`");
    expect(styleBlock).not.toContain("transform:");
    expect(styleBlock).not.toContain("will-change");
    expect(unitViewSource).toContain("const liveUnit = () => props.unit;");
  });

  it("does not publish reactive drag positions when no links need a preview", () => {
    const dragSource = readSource("src/hooks/useDraggable.ts");
    const linksSource = readSource("src/components/CanvasLinks.tsx");
    const applyBlock = sourceBetween(
      dragSource,
      "const applyDragMoveSnapshot =",
      "const flushPendingDragMove =",
    );
    const renderPathsBlock = sourceBetween(
      linksSource,
      "const renderPaths = createMemo(() => {",
      "const selectedOverlayLinks = createMemo",
    );

    expect(applyBlock).toContain("graphStore.links.length > 0");
    expect(applyBlock).toContain("LINK_PREVIEW_INTERVAL_MS");
    expect(applyBlock).toContain("setMultiDragPositions(nextPositions);");
    expect(renderPathsBlock).toContain("if (currentLinks.length === 0) {");
    expect(renderPathsBlock.indexOf("if (currentLinks.length === 0) {")).toBeLessThan(
      renderPathsBlock.indexOf("const dPositions = multiDragPositions();"),
    );
  });

  it("indexes units and shared layout reads once before rebuilding links", () => {
    const linksSource = readSource("src/components/CanvasLinks.tsx");
    const renderPathsBlock = sourceBetween(
      linksSource,
      "const renderPaths = createMemo(() => {",
      "const selectedOverlayLinks = createMemo",
    );

    expect(linksSource).toContain("const unitById = createMemo(");
    expect(renderPathsBlock).toContain("const currentUnitById = unitById();");
    expect(renderPathsBlock).not.toContain("new Map(");
    expect(renderPathsBlock).toContain("const allOffsets = portOffsets();");
    expect(renderPathsBlock).toContain("const cleanView = isCleanView();");
    expect(renderPathsBlock).not.toContain("list.find(");
    expect(renderPathsBlock).not.toContain("{ ...sFrom");
    expect(renderPathsBlock).not.toContain("{ ...sTo");
  });

  it("reuses the unit lookup memo for selected and hover overlays", () => {
    const linksSource = readSource("src/components/CanvasLinks.tsx");
    const selectedOverlayBlock = sourceBetween(
      linksSource,
      "const selectedOverlayLinks = createMemo",
      "const hoverPreviewLink = createMemo",
    );
    const hoverOverlayBlock = sourceBetween(
      linksSource,
      "const hoverPreviewLink = createMemo",
      "return (",
    );

    expect(selectedOverlayBlock).toContain("const currentUnitById = unitById();");
    expect(selectedOverlayBlock).not.toContain("graphStore.units.find(");
    expect(hoverOverlayBlock).toContain("const currentUnitById = unitById();");
    expect(hoverOverlayBlock).not.toContain("graphStore.units.find(");
    expect(selectedOverlayBlock).toContain("resolveUnitOverlayRect(target, dPositions)");
    expect(hoverOverlayBlock).toContain("resolveUnitOverlayRect(source, dPositions)");
  });

  it("builds alignment and cascade targets once at drag start instead of scanning every frame", () => {
    const dragSource = readSource("src/hooks/useDraggable.ts");
    const applyBlock = sourceBetween(
      dragSource,
      "const applyDragMoveSnapshot =",
      "const flushPendingDragMove =",
    );
    const startBlock = sourceBetween(
      dragSource,
      "const startDrag =",
      "const handleDragMove =",
    );

    expect(startBlock).toContain("buildDragTargetIndex(graphStore.units, draggedUnitIds)");
    expect(applyBlock).toContain("dragTargetIndex?.findCascadeTarget");
    expect(applyBlock).toContain("dragTargetIndex.findAlignmentTargets");
    expect(applyBlock).not.toContain("graphStore.units.find(");
    expect(applyBlock).not.toContain("graphStore.units.filter(");
    expect(applyBlock).not.toContain("const allUnits = graphStore.units");
  });

  it("cleans abandoned GPU-warm drags on all lifecycle escape paths", () => {
    const dragSource = readSource("src/hooks/useDraggable.ts");

    expect(dragSource).toContain('window.addEventListener("blur", handleWindowBlur)');
    expect(dragSource).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
    expect(dragSource).toContain('window.addEventListener("pointercancel", handlePointerCancel, true)');
    expect(dragSource).toContain('document.visibilityState === "hidden"');
    expect(dragSource).toContain("DRAG_WATCHDOG_TIMEOUT_MS");
    expect(dragSource).toContain('abortActiveDrag("watchdog")');
    expect(dragSource).toContain("finishGpuWarmDrag();");
  });

  it("batches drag-start selection and toolbar state updates into one reactive flush", () => {
    const appSource = readSource("src/app.tsx");
    const mouseDownBlock = sourceBetween(
      appSource,
      "const onStartDragUnit = (e: MouseEvent, id: string) => {",
      "const resolveUnitImage = (id: string): string | undefined =>",
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
