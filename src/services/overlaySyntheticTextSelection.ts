type TextPosition = { node: Node; offset: number };

type TextCaretStop = {
    node: Text;
    beforeOffset: number;
    afterOffset: number;
    rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
};

type CaretDocument = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
        x: number,
        y: number,
    ) => { offsetNode: Node; offset: number } | null;
};

export type OverlaySyntheticCaretResolver = (
    doc: Document,
    x: number,
    y: number,
) => TextPosition | null;

const SELECTABLE_SELECTOR = "[data-surface-selectable-text='true']";
const MAX_FALLBACK_CARET_STOPS = 4096;

const defaultCaretResolver: OverlaySyntheticCaretResolver = (doc, x, y) => {
    const caretDoc = doc as CaretDocument;
    const range = caretDoc.caretRangeFromPoint?.(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
    const position = caretDoc.caretPositionFromPoint?.(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
};

const clampPoint = (element: Element, x: number, y: number): [number, number] => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [x, y];
    return [
        Math.min(Math.max(x, rect.left + 0.5), rect.right - 0.5),
        Math.min(Math.max(y, rect.top + 0.5), rect.bottom - 0.5),
    ];
};

const selectableElement = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const element = target.closest(SELECTABLE_SELECTOR);
    return element instanceof HTMLElement ? element : null;
};

const selectableElementAtPoint = (
    doc: Document,
    win: Window,
    x: number,
    y: number,
): HTMLElement | null => {
    const candidates = doc.querySelectorAll<HTMLElement>(SELECTABLE_SELECTOR);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        if (win.getComputedStyle(candidate).pointerEvents === "none") continue;
        const rect = candidate.getBoundingClientRect();
        if (
            rect.width > 0
            && rect.height > 0
            && x >= rect.left
            && x <= rect.right
            && y >= rect.top
            && y <= rect.bottom
        ) {
            return candidate;
        }
    }
    return null;
};

const textNodesWithin = (doc: Document, root: HTMLElement): Text[] => {
    const walker = doc.createTreeWalker(root, 4);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
        if (current instanceof Text && current.data.length > 0) nodes.push(current);
        current = walker.nextNode();
    }
    return nodes;
};

const fallbackCaretStops = (doc: Document, root: HTMLElement): TextCaretStop[] => {
    const nodes = textNodesWithin(doc, root);
    const totalCharacters = nodes.reduce((total, node) => total + node.data.length, 0);
    const step = Math.max(1, Math.ceil(totalCharacters / MAX_FALLBACK_CARET_STOPS));
    const stops: TextCaretStop[] = [];
    for (const node of nodes) {
        for (let offset = 0; offset < node.data.length; offset += step) {
            const end = Math.min(offset + step, node.data.length);
            const range = doc.createRange();
            range.setStart(node, offset);
            range.setEnd(node, end);
            const rects = typeof range.getClientRects === "function"
                ? Array.from(range.getClientRects())
                : [];
            const fallbackRect = range.getBoundingClientRect?.();
            const visibleRects = rects.length > 0
                ? rects
                : fallbackRect ? [fallbackRect] : [];
            for (const rect of visibleRects) {
                if (rect.width <= 0 && rect.height <= 0) continue;
                stops.push({
                    node,
                    beforeOffset: offset,
                    afterOffset: end,
                    rect,
                });
            }
        }
    }
    return stops;
};

const closestFallbackCaret = (
    root: HTMLElement,
    stops: TextCaretStop[],
    x: number,
    y: number,
): TextPosition | null => {
    let closest: { position: TextPosition; distance: number } | null = null;
    for (const stop of stops) {
        const horizontal = x < stop.rect.left
            ? stop.rect.left - x
            : x > stop.rect.right ? x - stop.rect.right : 0;
        const vertical = y < stop.rect.top
            ? stop.rect.top - y
            : y > stop.rect.bottom ? y - stop.rect.bottom : 0;
        const distance = horizontal * horizontal + vertical * vertical * 4;
        const position = {
            node: stop.node,
            offset: x <= (stop.rect.left + stop.rect.right) / 2
                ? stop.beforeOffset
                : stop.afterOffset,
        };
        if (!closest || distance < closest.distance) closest = { position, distance };
    }
    if (closest) return closest.position;

    const nodes = textNodesWithin(root.ownerDocument, root);
    if (nodes.length === 0) return null;
    const rect = root.getBoundingClientRect();
    return x <= rect.left + rect.width / 2
        ? { node: nodes[0], offset: 0 }
        : { node: nodes[nodes.length - 1], offset: nodes[nodes.length - 1].data.length };
};

const setDomSelection = (
    doc: Document,
    anchor: TextPosition,
    focus: TextPosition,
): boolean => {
    const selection = doc.getSelection();
    if (!selection) return false;
    try {
        if (typeof selection.setBaseAndExtent === "function") {
            selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
            return !selection.isCollapsed && selection.toString().length > 0;
        }

        const anchorRange = doc.createRange();
        anchorRange.setStart(anchor.node, anchor.offset);
        anchorRange.collapse(true);
        const focusBeforeAnchor = anchorRange.comparePoint(focus.node, focus.offset) < 0;
        const range = doc.createRange();
        if (focusBeforeAnchor) {
            range.setStart(focus.node, focus.offset);
            range.setEnd(anchor.node, anchor.offset);
        } else {
            range.setStart(anchor.node, anchor.offset);
            range.setEnd(focus.node, focus.offset);
        }
        selection.removeAllRanges();
        selection.addRange(range);
        return !selection.isCollapsed && selection.toString().length > 0;
    } catch {
        return false;
    }
};

const createTextareaMirror = (
    doc: Document,
    win: Window,
    textarea: HTMLTextAreaElement,
): { element: HTMLDivElement; text: Text } | null => {
    if (!doc.body) return null;
    const rect = textarea.getBoundingClientRect();
    const computed = win.getComputedStyle(textarea);
    const mirror = doc.createElement("div");
    mirror.dataset.overlaySyntheticTextareaMirror = "true";
    mirror.setAttribute("aria-hidden", "true");
    for (const property of [
        "font-family", "font-size", "font-style", "font-weight", "font-variant",
        "letter-spacing", "line-height", "text-align", "text-indent", "text-transform",
        "padding-top", "padding-right", "padding-bottom", "padding-left",
        "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
        "box-sizing", "tab-size", "word-break",
    ]) {
        mirror.style.setProperty(property, computed.getPropertyValue(property));
    }
    Object.assign(mirror.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        color: "transparent",
        background: "transparent",
        borderStyle: "solid",
        borderColor: "transparent",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        overflowX: "hidden",
        // `overflow:auto` paints a second native scrollbar above the textarea
        // while the pointer is down. Hidden remains programmatically scrollable,
        // so caret geometry can follow scrollTop without changing the visible bar.
        overflowY: "hidden",
        pointerEvents: "none",
        zIndex: "2147483647",
    });
    const text = doc.createTextNode(textarea.value || "\u200b");
    mirror.append(text);
    doc.body.append(mirror);
    mirror.scrollTop = textarea.scrollTop;
    return { element: mirror, text };
};

/** Recreates browser text-selection defaults that native overlay shielding suppresses. */
export const createOverlaySyntheticTextSelection = (
    doc: Document,
    win: Window,
    resolveCaret: OverlaySyntheticCaretResolver = defaultCaretResolver,
) => {
    let root: HTMLElement | null = null;
    let anchor: TextPosition | null = null;
    let textareaAnchor: number | null = null;
    let mirror: { element: HTMLDivElement; text: Text } | null = null;
    let caretStops: TextCaretStop[] = [];

    const disposeMirror = () => {
        mirror?.element.remove();
        mirror = null;
    };
    const reset = () => {
        disposeMirror();
        root = null;
        anchor = null;
        textareaAnchor = null;
        caretStops = [];
    };
    const textPosition = (element: HTMLElement, x: number, y: number): TextPosition | null => {
        const [clampedX, clampedY] = clampPoint(element, x, y);
        const resolved = resolveCaret(doc, clampedX, clampedY);
        if (resolved && element.contains(resolved.node)) return resolved;
        if (caretStops.length === 0) caretStops = fallbackCaretStops(doc, element);
        return closestFallbackCaret(element, caretStops, clampedX, clampedY);
    };
    const textareaIndex = (textarea: HTMLTextAreaElement, x: number, y: number): number | null => {
        if (!mirror?.element.isConnected) return null;
        const [clampedX, clampedY] = clampPoint(textarea, x, y);
        mirror.element.scrollTop = textarea.scrollTop;
        mirror.element.scrollLeft = textarea.scrollLeft;
        // Keep the mirror out of ordinary hit testing. It owns the point only
        // for this synchronous caret query, then immediately releases it.
        mirror.element.style.pointerEvents = "auto";
        let position: TextPosition | null = null;
        try {
            position = resolveCaret(doc, clampedX, clampedY);
        } finally {
            mirror.element.style.pointerEvents = "none";
        }
        if (!position || !mirror.element.contains(position.node)) return null;
        if (position.node === mirror.text) {
            return Math.min(Math.max(position.offset, 0), textarea.value.length);
        }
        return position.offset <= 0 ? 0 : textarea.value.length;
    };
    const update = (x: number, y: number): boolean => {
        if (!root) return false;
        if (root instanceof HTMLTextAreaElement && textareaAnchor !== null) {
            const focus = textareaIndex(root, x, y);
            if (focus === null) return false;
            root.setSelectionRange(
                Math.min(textareaAnchor, focus),
                Math.max(textareaAnchor, focus),
                focus < textareaAnchor ? "backward" : "forward",
            );
            return focus !== textareaAnchor;
        }
        if (!anchor) return false;
        const focus = textPosition(root, x, y);
        if (!focus) return false;
        return setDomSelection(doc, anchor, focus);
    };
    const begin = (target: EventTarget | null, x: number, y: number): boolean => {
        reset();
        root = selectableElement(target) ?? selectableElementAtPoint(doc, win, x, y);
        if (!root) return false;
        if (root instanceof HTMLTextAreaElement) {
            mirror = createTextareaMirror(doc, win, root);
            textareaAnchor = textareaIndex(root, x, y);
            if (textareaAnchor === null) {
                reset();
                return false;
            }
            root.setSelectionRange(textareaAnchor, textareaAnchor);
            return true;
        }
        anchor = textPosition(root, x, y);
        if (!anchor) {
            reset();
            return false;
        }
        setDomSelection(doc, anchor, anchor);
        return true;
    };
    const finish = (x: number, y: number): boolean => {
        const selected = update(x, y);
        reset();
        return selected;
    };
    const scroll = (target: EventTarget | null, deltaY: number): boolean => {
        const selectable = selectableElement(target);
        if (!(selectable instanceof HTMLTextAreaElement) || !Number.isFinite(deltaY)) return false;
        selectable.scrollTop = Math.min(
            Math.max(selectable.scrollTop + deltaY, 0),
            Math.max(selectable.scrollHeight - selectable.clientHeight, 0),
        );
        return true;
    };

    return {
        begin,
        update,
        finish,
        reset,
        scroll,
        get active() {
            return root !== null;
        },
        get target() {
            return root;
        },
    };
};
