const HOLD_DELAY_MS = 450;
const MOVE_TOLERANCE_PX = 6;

/** 捕获阶段同时接收真实及原生转发的指针事件，避免子按钮阻止冒泡。 */
export const installStickerTopStripLongPress = (root: HTMLDivElement): (() => void) => {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pressed: HTMLButtonElement | null = null;
    let suppressed: HTMLButtonElement | null = null;
    let pointerId: number | undefined;
    let startX = 0;
    let startY = 0;
    const buttonAt = (target: EventTarget | null) => target instanceof Element ? target.closest("button") : null;
    const cancelHold = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        pressed = null;
        pointerId = undefined;
    };
    const reset = () => { cancelHold(); suppressed = null; };
    const down = (event: PointerEvent) => {
        reset();
        if (event.button !== 0 || !event.isPrimary) return;
        const button = buttonAt(event.target);
        if (!button || !root.contains(button) || button.disabled
            || !button.classList.contains("otter-toolbar-button")) return;
        const toggle = button.nextElementSibling;
        if (!(toggle instanceof HTMLButtonElement) || toggle.disabled
            || !toggle.classList.contains("otter-toolbar-corner-toggle")) return;
        pressed = button;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        timer = setTimeout(() => {
            timer = undefined;
            if (!button.isConnected || button.disabled || !toggle.isConnected || toggle.disabled) {
                cancelHold();
                return;
            }
            suppressed = button;
            // 菜单已展开时保持展开，不把长按变成关闭操作。
            if (!button.parentElement?.querySelector("[data-top-strip-menu='true']")) toggle.click();
        }, HOLD_DELAY_MS);
    };
    const move = (event: PointerEvent) => {
        if (!pressed || event.pointerId !== pointerId) return;
        const bounds = pressed.getBoundingClientRect();
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX
            || event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom) cancelHold();
    };
    const up = (event: PointerEvent) => {
        if (event.pointerId === pointerId) cancelHold();
        // 保留抑制标记，拦截随后由浏览器或原生桥补发的 click。
    };
    const click = (event: MouseEvent) => {
        if (!suppressed || buttonAt(event.target) !== suppressed) return;
        suppressed = null;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    doc.addEventListener("pointerdown", down, true);
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", reset, true);
    doc.addEventListener("keydown", reset, true);
    root.addEventListener("click", click, true);
    win?.addEventListener("blur", reset);
    return () => {
        reset();
        doc.removeEventListener("pointerdown", down, true);
        doc.removeEventListener("pointermove", move, true);
        doc.removeEventListener("pointerup", up, true);
        doc.removeEventListener("pointercancel", reset, true);
        doc.removeEventListener("keydown", reset, true);
        root.removeEventListener("click", click, true);
        win?.removeEventListener("blur", reset);
    };
};
