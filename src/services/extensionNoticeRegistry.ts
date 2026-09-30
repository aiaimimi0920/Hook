import { uiActions } from "../store/uiStore";
import { MAX_ENHANCEMENT_NOTICES_PER_UNIT } from "./enhancementNoticeQueue";
import type { ContributionSnapshot } from "./extensionProtocol";

let nextExtensionNoticeId = 1_000_000_000;

/** Tracks unit notices by extension scope so disable/disconnect removes owned transient UI. */
export class ExtensionNoticeRegistry {
    private readonly noticesByScope = new Map<string, Map<string, Set<number>>>();

    show(scopeId: string, unitId: string, payload: Record<string, unknown>): void {
        const units = this.noticesByScope.get(scopeId) ?? new Map<string, Set<number>>();
        const noticeIds = units.get(unitId) ?? new Set<number>();
        const id = nextExtensionNoticeId++;
        noticeIds.add(id);
        while (noticeIds.size > MAX_ENHANCEMENT_NOTICES_PER_UNIT) {
            const oldest = noticeIds.values().next().value;
            if (typeof oldest !== "number") break;
            noticeIds.delete(oldest);
        }
        units.set(unitId, noticeIds);
        this.noticesByScope.set(scopeId, units);
        uiActions.showEnhancementNotice(unitId, {
            id,
            feature: "Loom",
            title: typeof payload.title === "string" ? payload.title.slice(0, 128) : "扩展能力",
            message: typeof payload.message === "string" ? payload.message.slice(0, 2048) : "操作已完成",
            source: { namespace: "extension", id: scopeId },
        });
    }

    applySnapshot(snapshot: ContributionSnapshot | null): void {
        const activeScopes = new Set(snapshot?.plugins
            .filter((plugin) => ["trusted", "unsigned_developer"].includes(plugin.trustStatus))
            .map((plugin) => plugin.scopeId) ?? []);
        for (const [scopeId, unitNotices] of this.noticesByScope) {
            if (activeScopes.has(scopeId)) continue;
            for (const [unitId, noticeIds] of unitNotices) {
                for (const noticeId of noticeIds) uiActions.dismissEnhancementNotice(unitId, noticeId);
            }
            this.noticesByScope.delete(scopeId);
        }
    }
}

export const extensionNoticeRegistry = new ExtensionNoticeRegistry();
