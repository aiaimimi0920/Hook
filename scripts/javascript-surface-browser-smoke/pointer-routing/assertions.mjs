export const assertPointerRoutingResult = (result, controls) => {
    if (result.activationCount < 4) {
        throw new Error(`pointer-routing did not activate the host for trusted and native-shield targets: ${JSON.stringify(result)}`);
    }
    if (result.dragStartCount !== 5) {
        throw new Error(`pointer-routing must start each background gesture once and never drag controls: ${JSON.stringify(result)}`);
    }
    if (
        result.dragGestureIds.some((gestureId) => !Number.isSafeInteger(gestureId) || gestureId <= 0)
        || [101, 201, 203, 301].some(
            (gestureId) => result.dragGestureIds.filter((value) => value === gestureId).length !== 1,
        )
        || result.dragGestureIds.includes(102)
        || result.dragGestureIds.includes(103)
    ) {
        throw new Error(`pointer-routing did not preserve gesture ownership: ${JSON.stringify(result)}`);
    }
    if (
        result.dragMoveGestureIds.filter((gestureId) => gestureId === 101).length !== 1
        || result.dragMoveGestureIds.filter((gestureId) => gestureId === 301).length !== 1
        || result.dragEndCount !== 5
        || [101, 201, 203, 301].some(
            (gestureId) => result.dragEndGestureIds.filter((value) => value === gestureId).length !== 1,
        )
    ) {
        throw new Error(`pointer-routing did not relay a complete drag stream: ${JSON.stringify(result)}`);
    }
    if (!Number.isFinite(result.dragPointer?.x) || !Number.isFinite(result.dragPointer?.y)) {
        throw new Error(`pointer-routing returned invalid drag coordinates: ${JSON.stringify(result)}`);
    }
    if (result.dragEndPointer?.pointerId !== result.dragPointer?.pointerId) {
        throw new Error(`pointer-routing changed pointer identity mid-drag: ${JSON.stringify(result)}`);
    }
    const expectedTrustedDragPoint = { x: controls.chart.x + 60, y: controls.chart.y + 40 };
    if (
        Math.abs(result.dragPointer.x - expectedTrustedDragPoint.x) > 2
        || Math.abs(result.dragPointer.y - expectedTrustedDragPoint.y) > 2
        || Math.abs(result.dragPointer.normalizedX - expectedTrustedDragPoint.x / 320) > 0.015
        || Math.abs(result.dragPointer.normalizedY - expectedTrustedDragPoint.y / 200) > 0.015
    ) {
        throw new Error(`pointer-routing changed transformed Surface coordinates: ${JSON.stringify(result)}`);
    }
    if (result.inputState?.activeId !== "symbol" || result.inputState?.value !== "SH600000") {
        throw new Error(`pointer-routing could not focus and edit the Surface input: ${JSON.stringify(result)}`);
    }
    if (result.refreshClicks !== 2) {
        throw new Error(`pointer-routing could not click the Surface button after native jitter: ${JSON.stringify(result)}`);
    }
    if (!result.hostWheels?.some((wheel) => wheel?.ctrlKey === true && wheel?.deltaY < 0)) {
        throw new Error(`pointer-routing did not bridge the modifier wheel gesture: ${JSON.stringify(result)}`);
    }
    if (!result.hostWheels?.some((wheel) => wheel?.altKey === true && wheel?.deltaY > 0)) {
        throw new Error(`pointer-routing did not bridge the opacity wheel gesture: ${JSON.stringify(result)}`);
    }
    if (!result.hostKeydowns?.some((keydown) => keydown?.code === "KeyE" && keydown?.ctrlKey === true)) {
        throw new Error(`pointer-routing did not bridge Ctrl+E from the focused Surface input: ${JSON.stringify(result)}`);
    }
    if (result.hostKeydowns?.filter((keydown) => keydown?.key === "Escape").length !== 1) {
        throw new Error(`pointer-routing must bridge only an unconsumed Escape from the focused Surface input: ${JSON.stringify(result)}`);
    }
};
