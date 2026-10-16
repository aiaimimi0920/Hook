import { createSignal } from "solid-js";

export type UnitChromeMode = "all" | "border" | "none";
export const [unitChromeMode, setUnitChromeMode] = createSignal<UnitChromeMode>("all");
export const isCleanView = () => unitChromeMode() === "none";
export const hideCollapsedUnitEndpoints = (hidden?: boolean) => unitChromeMode() !== "all" || !!hidden;
export const unitEndpointsVisible = (expanded: boolean, hidden?: boolean) => expanded || !hideCollapsedUnitEndpoints(hidden);

export function cycleUnitChromeMode(): void {
    setUnitChromeMode((mode) => mode === "all" ? "border" : mode === "border" ? "none" : "all");
}

// Preserve the boolean API for existing clean-view consumers and reset paths.
export function setIsCleanView(value: boolean | ((previous: boolean) => boolean)): boolean {
    const next = typeof value === "function" ? value(isCleanView()) : value;
    setUnitChromeMode(next ? "none" : "all");
    return next;
}
