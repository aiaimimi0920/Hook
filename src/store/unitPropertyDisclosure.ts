import { createSignal } from "solid-js";
import { selectionActions } from "./uiStore";

export const [unitPropertyDisclosure, setUnitPropertyDisclosure] = createSignal<{
    unitId: string; name: string; side: "input" | "output";
} | null>(null);

export function requestUnitPropertyDisclosure(unitId: string, name: string, side: "input" | "output") {
    setUnitPropertyDisclosure({ unitId, name, side });
    selectionActions.set([unitId]);
}
