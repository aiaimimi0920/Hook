import type { StickerAnnotation } from "./stickerEditing";

export type ProjectionEditMode = "one_way" | "two_way";
export type ProjectionEditObjects = Record<string, StickerAnnotation>;
export interface ProjectionEditBasis { digest: string; width: number; height: number }
export interface ProjectionEditDocument {
    schema: "neuro.projection-edit.v1";
    sessionId: string;
    basis: ProjectionEditBasis;
    revision: number;
    modeRevision: number;
    checkpointRevision: number;
    receiptCount: number;
    mode: ProjectionEditMode;
    objects: Record<string, { revision: number; value: StickerAnnotation | null }>;
}
export interface ProjectionEditChange { objectId: string; value: StickerAnnotation | null }
export type ProjectionEditRequest =
    | { operation: "read"; projectionId: string }
    | { operation: "initialize"; projectionId: string; sessionId: string; expectedDigest: string; objects: ProjectionEditObjects }
    | { operation: "attach"; projectionId: string; sessionId: string }
    | { operation: "mode"; projectionId: string; sessionId: string; opId: string; baseModeRevision: number; mode: ProjectionEditMode }
    | { operation: "apply"; projectionId: string; sessionId: string; opId: string; baseRevision: number; modeRevision: number; changes: ProjectionEditChange[] }
    | { operation: "checkpoint"; projectionId: string; sessionId: string; expectedRevision: number };
export interface ProjectionEditView { w: number; h: number; objects: ProjectionEditObjects }
