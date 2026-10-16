/** Mutable state for exactly one overlay pointer dispatcher. */
export interface OverlaySyntheticState {
    pointerTarget: EventTarget | null;
    pointerDownTarget: EventTarget | null;
    pointerDownInteractiveTarget: Element | null;
    hoverTarget: EventTarget | null;
    pointerDownPoint: { x: number; y: number } | null;
    lastClickTarget: EventTarget | null;
    lastClickPoint: { x: number; y: number } | null;
    lastClickAt: number;
    pointerActive: boolean;
    primaryButtonDown: boolean;
    moveRelayActive: boolean;
    gestureSequence: number;
    activeGestureId: number | null;
}

export const createOverlaySyntheticState = (): OverlaySyntheticState => ({
    pointerTarget: null,
    pointerDownTarget: null,
    pointerDownInteractiveTarget: null,
    hoverTarget: null,
    pointerDownPoint: null,
    lastClickTarget: null,
    lastClickPoint: null,
    lastClickAt: 0,
    pointerActive: false,
    primaryButtonDown: false,
    moveRelayActive: false,
    gestureSequence: 0,
    activeGestureId: null,
});

export const nextOverlaySyntheticGestureId = (state: OverlaySyntheticState): number => {
    state.gestureSequence = state.gestureSequence >= Number.MAX_SAFE_INTEGER
        ? 1
        : state.gestureSequence + 1;
    return state.gestureSequence;
};

/** Reset the active pointer session without erasing hover or click history. */
export const resetOverlaySyntheticState = (state: OverlaySyntheticState): void => {
    state.pointerTarget = null;
    state.pointerDownTarget = null;
    state.pointerDownInteractiveTarget = null;
    state.pointerDownPoint = null;
    state.pointerActive = false;
    state.primaryButtonDown = false;
    state.moveRelayActive = false;
    state.activeGestureId = null;
};
