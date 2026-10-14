/** Measure the full anchor, not the clipped half-glyph or the pointer position. */
export function unitPortCenter(element: HTMLElement): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
