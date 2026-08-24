import type { OverlaySyntheticDeps } from "./overlaySyntheticTypes";

const INTERACTIVE_TARGET_SELECTOR =
    "input, select, textarea, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag]";

export interface OverlaySyntheticTargets {
    getAppMain: () => HTMLElement | null;
    resolveJavaScriptSurfaceFrame: (target: EventTarget) => HTMLIFrameElement | null;
    resolveInteractiveSyntheticTarget: (target: EventTarget | null) => Element | null;
    focusEditableSyntheticControl: (target: EventTarget | null) => void;
    isStickerInteractionRootTarget: (target: EventTarget | null) => boolean;
    resolveTarget: (
        clientX: number,
        clientY: number,
        allowFallback: boolean,
        appMain: HTMLElement | null,
    ) => EventTarget | null;
}

export const createOverlaySyntheticTargets = (
    deps: OverlaySyntheticDeps,
    win: Window,
): OverlaySyntheticTargets => {
    const { doc } = deps;
    const elementFromPoint =
        deps.elementFromPoint ?? ((x: number, y: number) => doc.elementFromPoint(x, y));

    const resolveJavaScriptSurfaceFrame = (
        target: EventTarget,
    ): HTMLIFrameElement | null => {
        if (
            target instanceof HTMLIFrameElement &&
            target.dataset.javascriptSurfaceFrame === "true"
        ) {
            return target;
        }
        if (!(target instanceof Element)) return null;
        const host = target.closest(".javascript-surface-host");
        const frameSelector = "iframe[data-javascript-surface-frame='true']";
        return host?.querySelector<HTMLIFrameElement>(frameSelector)
            ?? target.querySelector<HTMLIFrameElement>(frameSelector)
            ?? target.closest(".art-surface-presentation")?.querySelector<HTMLIFrameElement>(frameSelector)
            ?? null;
    };

    const containsPoint = (element: Element, clientX: number, clientY: number): boolean => {
        if (element instanceof HTMLElement) {
            const computedPointerEvents = typeof win.getComputedStyle === "function"
                ? win.getComputedStyle(element).pointerEvents
                : "";
            if (element.style.pointerEvents === "none" || computedPointerEvents === "none") {
                return false;
            }
        }
        const rect = element.getBoundingClientRect();
        return (
            rect.width > 0
            && rect.height > 0
            && clientX >= rect.left
            && clientX <= rect.right
            && clientY >= rect.top
            && clientY <= rect.bottom
        );
    };

    const resolveSurfaceTargetBehindStickerInteraction = (
        stickerInteractionRoot: Element,
        clientX: number,
        clientY: number,
    ): Element | null => {
        // Blank annotation roots sit above the live Art Surface. Let only those
        // roots fall through; real annotation descendants keep ownership.
        if (
            stickerInteractionRoot.getAttribute("data-sticker-surface-pass-through") !== "true"
        ) {
            return null;
        }
        const visual = stickerInteractionRoot.closest(".sticker-visual");
        const frame = visual?.querySelector<HTMLIFrameElement>(
            ".art-surface-presentation iframe[data-javascript-surface-frame='true']",
        );
        if (frame && containsPoint(frame, clientX, clientY)) return frame;

        const presentation = visual?.querySelector<HTMLElement>(".art-surface-presentation");
        if (!presentation || !containsPoint(presentation, clientX, clientY)) return null;

        const controls = presentation.querySelectorAll<HTMLElement>(
            "input, select, textarea, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag], [data-surface-node-id]",
        );
        for (let index = controls.length - 1; index >= 0; index -= 1) {
            if (containsPoint(controls[index], clientX, clientY)) return controls[index];
        }
        // A blank declarative Surface still bubbles through UnitView so normal
        // Art-node dragging remains available.
        return presentation;
    };

    const resolveEditableSyntheticControl = (target: EventTarget | null): Element | null => {
        if (!(target instanceof Element)) return null;
        if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLSelectElement ||
            target instanceof HTMLTextAreaElement
        ) {
            return target;
        }
        return target.closest("input, select, textarea");
    };

    const focusEditableSyntheticControl = (target: EventTarget | null): void => {
        const editable = resolveEditableSyntheticControl(target);
        if (!editable || !(editable instanceof HTMLElement)) return;
        editable.focus();
    };

    const resolveInteractiveSyntheticTarget = (target: EventTarget | null): Element | null => {
        if (!(target instanceof Element)) return null;
        if (target.matches(INTERACTIVE_TARGET_SELECTOR)) return target;
        return target.closest(INTERACTIVE_TARGET_SELECTOR);
    };

    const isOverlayRootTarget = (
        target: EventTarget | null,
        appMain: HTMLElement | null,
    ): boolean => (
        target === appMain
        || target === doc.body
        || target === doc.documentElement
        || target === win
    );

    const resolveTarget = (
        clientX: number,
        clientY: number,
        allowFallback: boolean,
        appMain: HTMLElement | null,
    ): EventTarget | null => {
        const rawTarget = elementFromPoint(clientX, clientY) as EventTarget | null;
        if (!rawTarget || isOverlayRootTarget(rawTarget, appMain)) {
            return allowFallback ? appMain ?? win : null;
        }
        if (rawTarget instanceof Element) {
            if (rawTarget.closest?.("[data-overlay-synthetic-target='direct']")) {
                return rawTarget;
            }
            const stickerInteractionRoot =
                rawTarget.closest?.("[data-sticker-interaction-root='true']") ?? null;
            if (stickerInteractionRoot) {
                const isBlankStickerInteractionHit =
                    rawTarget === stickerInteractionRoot
                    || (
                        typeof SVGElement !== "undefined"
                        && rawTarget instanceof SVGElement
                        && rawTarget.tagName.toLowerCase() === "svg"
                    );
                if (isBlankStickerInteractionHit) {
                    const surfaceTarget = resolveSurfaceTargetBehindStickerInteraction(
                        stickerInteractionRoot,
                        clientX,
                        clientY,
                    );
                    if (surfaceTarget) return surfaceTarget;
                }
                return stickerInteractionRoot;
            }
        }
        return rawTarget;
    };

    return {
        getAppMain: () => doc.getElementById("app-main"),
        resolveJavaScriptSurfaceFrame,
        resolveInteractiveSyntheticTarget,
        focusEditableSyntheticControl,
        isStickerInteractionRootTarget: (target) => (
            target instanceof Element
            && target.getAttribute("data-sticker-interaction-root") === "true"
        ),
        resolveTarget,
    };
};
