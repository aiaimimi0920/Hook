/** 合成指针事件不会设置 CSS :hover，因此在主编辑栏内同步显式悬浮状态。 */
export const createStickerTopStripHover = () => {
    let hovered: HTMLButtonElement | null = null;
    const clear = () => {
        hovered?.removeAttribute("data-toolbar-hover");
        hovered = null;
    };
    const over = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
        const target = event.target;
        const button = target instanceof Element ? target.closest("button") : null;
        const next = button && event.currentTarget.contains(button) && !button.disabled ? button : null;
        if (hovered === next) return;
        clear();
        hovered = next;
        hovered?.setAttribute("data-toolbar-hover", "true");
    };
    const out = (event: PointerEvent) => {
        if (event.relatedTarget instanceof Node && hovered?.contains(event.relatedTarget)) return;
        clear();
    };
    return { over, out, clear };
};
