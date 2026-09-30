/** Bounded, unit-scoped notice inputs used by visual overlay surfaces. */
export type EnhancementNoticeFeature = "OCR" | "Translation" | "Loom" | "Interaction";

export interface EnhancementNotice {
    id: number;
    feature: EnhancementNoticeFeature;
    title: string;
    message: string;
    source?: { namespace: "core" | "extension"; id?: string };
}

export type EnhancementNoticeInput = Omit<EnhancementNotice, "id">;

// The queue is intentionally bounded so repeated background failures cannot
// retain unbounded transient UI state in a long-lived canvas.
export const MAX_ENHANCEMENT_NOTICES_PER_UNIT = 8;
let nextEnhancementNoticeId = 1;

export const normalizeEnhancementNotice = (
    notice: EnhancementNoticeInput | EnhancementNotice,
): EnhancementNotice => {
    const suppliedId = "id" in notice ? notice.id : undefined;
    const id = typeof suppliedId === "number" && Number.isSafeInteger(suppliedId) && suppliedId > 0
        ? suppliedId
        : nextEnhancementNoticeId++;
    if (id >= nextEnhancementNoticeId) nextEnhancementNoticeId = id + 1;
    return { id, feature: notice.feature, title: notice.title, message: notice.message, source: notice.source };
};

export const appendEnhancementNotice = (
    current: EnhancementNotice[] | undefined,
    nextNotice: EnhancementNotice,
) => [...(current ?? []), nextNotice].slice(-MAX_ENHANCEMENT_NOTICES_PER_UNIT);

/** Keeps the newest feedback visible when the bounded stack starts scrolling. */
export const orderEnhancementNoticesForDisplay = (
    current: EnhancementNotice[] | undefined,
) => [...(current ?? [])].reverse();

export const removeEnhancementNotice = (
    current: EnhancementNotice[] | undefined,
    noticeId: number,
) => {
    const remaining = (current ?? []).filter((notice) => notice.id !== noticeId);
    return remaining.length > 0 ? remaining : undefined;
};

export const removeEnhancementNoticesByFeature = (
    current: EnhancementNotice[] | undefined,
    feature: EnhancementNoticeFeature,
) => {
    const remaining = (current ?? []).filter((notice) => notice.feature !== feature);
    return remaining.length > 0 ? remaining : undefined;
};
