import { describe, expect, it } from "vitest";

import {
    LEGACY_OCR_ATTACHMENT_ID,
    migrateLegacyOcrResultToAttachment,
} from "../../src/services/legacyOcrAttachmentMigration";
import type { UnitData } from "../../src/types/unit";
import type { UnitExtensionState } from "../../src/types/unitExtension";

type LegacyOcrResult = NonNullable<UnitData["ocrResult"]>;

const legacyResult = (): LegacyOcrResult => ({
    fullText: "第一行\n第二行",
    width: 200,
    height: 100,
    scaleFactor: 2,
    textBlocks: [{
        text: "第一行",
        boxPoints: [
            { x: 20, y: 20 },
            { x: 180, y: 20 },
            { x: 180, y: 60 },
            { x: 20, y: 60 },
        ],
        boxScore: 0.98,
        textScore: 0.97,
        colorHex: "#ffffff",
        bgColorHex: "#101010",
        rawText: "第一行",
        translatedText: "first line",
        translating: false,
        lineGeometry: {
            baseline: [{ x: 20, y: 55 }, { x: 180, y: 55 }],
            angleDegrees: 0,
            source: "estimatedFromRapidOcrLineQuad",
        },
        characterSpans: [{
            text: "第",
            boxPoints: [
                { x: 20, y: 20 },
                { x: 50, y: 20 },
                { x: 50, y: 60 },
                { x: 20, y: 60 },
            ],
            score: 0.9,
            source: "ctcAlignedFromRecognitionTimesteps",
        }],
    }],
});

const attachmentPayload = (state: UnitExtensionState | undefined): Record<string, unknown> => {
    const attachment = state?.attachments.find((candidate) =>
        candidate.attachmentId === LEGACY_OCR_ATTACHMENT_ID);
    expect(attachment).toBeDefined();
    return attachment?.payload as Record<string, unknown>;
};

describe("legacy OCR attachment migration", () => {
    it("preserves text, translation, source geometry, and a clickable generic scene", () => {
        const result = migrateLegacyOcrResultToAttachment(legacyResult(), undefined);

        expect(result.migrated).toBe(true);
        expect(result.ocrResult).toBeUndefined();
        expect(result.extensionState?.revision).toBe(1);
        const payload = attachmentPayload(result.extensionState);
        expect(payload.fullText).toBe("第一行\n第二行");
        expect(payload.coordinateScale).toBe(2);
        expect(payload.migration).toEqual({ source: "hook.unitData.ocrResult", version: 1 });
        const block = (payload.textBlocks as Record<string, unknown>[])[0];
        expect(block).toMatchObject({
            text: "第一行",
            left: 10,
            top: 10,
            width: 80,
            height: 20,
            rawText: "第一行",
            translatedText: "first line",
            translating: false,
        });
        expect(block.boxPoints).toEqual(legacyResult().textBlocks[0].boxPoints);
        expect(block.characterSpans).toEqual(legacyResult().textBlocks[0].characterSpans);
        const scene = payload.surfaceScene as Record<string, unknown>;
        const children = scene.children as Record<string, unknown>[];
        expect(children[0]).toMatchObject({
            events: { click: "neuro.official/ocr.copy-block" },
            props: { eventPayload: { text: "第一行" } },
            children: [{ props: { text: "第一行", selectable: true } }],
        });
    });

    it("is idempotent when a complete official migration attachment already exists", () => {
        const first = migrateLegacyOcrResultToAttachment(legacyResult(), undefined);
        const second = migrateLegacyOcrResultToAttachment(legacyResult(), first.extensionState);

        expect(second).toEqual({
            ocrResult: undefined,
            extensionState: first.extensionState,
            migrated: true,
        });
    });

    it("keeps legacy data when the extension envelope is corrupt or the payload is over budget", () => {
        const legacy = legacyResult();
        const corruptEnvelope = migrateLegacyOcrResultToAttachment(legacy, undefined, false);
        expect(corruptEnvelope).toEqual({
            ocrResult: legacy,
            extensionState: undefined,
            migrated: false,
        });

        const oversized = { ...legacy, fullText: "中".repeat(40_000) };
        const rejected = migrateLegacyOcrResultToAttachment(oversized, undefined);
        expect(rejected.ocrResult).toBe(oversized);
        expect(rejected.extensionState).toBeUndefined();
        expect(rejected.migrated).toBe(false);
    });

    it("does not overwrite a conflicting attachment with the reserved migration id", () => {
        const state: UnitExtensionState = {
            schemaVersion: 1,
            revision: 4,
            attachments: [{
                attachmentId: LEGACY_OCR_ATTACHMENT_ID,
                typeId: "publisher.example/conflict.v1",
                schemaVersion: "1",
                revision: 1,
                pluginId: "neuro.official/ocr",
                pluginVersion: "1.0.0",
                payload: { value: "keep" },
                resourceRefs: [],
            }],
        };
        const legacy = legacyResult();
        const result = migrateLegacyOcrResultToAttachment(legacy, state);

        expect(result.ocrResult).toBe(legacy);
        expect(result.extensionState).toBe(state);
        expect(result.migrated).toBe(false);
    });
});
