import { graphStore } from "../store/graphStore";
import { uiActions } from "../store/uiStore";
import type { EnhancementNoticeInput } from "./enhancementNoticeQueue";

/** Resolve at delivery time: an asynchronous failure may outlive its owner. */
export function showUnitFailureNotice(notice: EnhancementNoticeInput, unitId?: string): void {
    const units = graphStore.units;
    let owner = unitId ? units.find((unit) => unit.id === unitId) : undefined;
    if (!owner) {
        for (let index = units.length - 1; index >= 0; index--) {
            if (units[index].type === "sticker") { owner = units[index]; break; }
        }
    }
    // An empty canvas has no interactive notice host. Never create a screen modal.
    if (owner) uiActions.showEnhancementNotice(owner.id, notice);
}
