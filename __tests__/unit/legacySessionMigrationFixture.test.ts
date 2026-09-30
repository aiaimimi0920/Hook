import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { mapSessionStickerToUnit } from "../../src/services/sessionStickerMapping";
import type { SessionSticker } from "../../src/types/unit";

type LegacySessionFixture = { stickers: SessionSticker[] };

const fixture = (): LegacySessionFixture => JSON.parse(readFileSync(resolve(
    process.cwd(),
    "__tests__/fixtures/session/legacy-ocr-barcode-session.json",
), "utf8")) as LegacySessionFixture;

describe("legacy persisted session migration fixture", () => {
    it("moves the complete OCR and barcode records into two official attachments", () => {
        const source = fixture().stickers[0];
        const restored = mapSessionStickerToUnit(source, { capabilities: [] });
        const attachments = restored.data.extensionState?.attachments ?? [];

        expect(restored.data.ocrResult).toBeUndefined();
        expect(restored.data.barcodeResult).toBeUndefined();
        expect(attachments.map((attachment) => attachment.attachmentId)).toEqual([
            "neuro.official/ocr.result",
            "neuro.official/ocr.codes",
        ]);
        expect(attachments[0]?.payload).toMatchObject({
            fullText: source.ocrResult?.fullText,
            migration: { source: "hook.unitData.ocrResult", version: 1 },
        });
        expect(attachments[1]?.payload).toMatchObject({
            results: source.barcodeResult?.results,
            migration: { source: "hook.unitData.barcodeResult", version: 1 },
        });
    });
});
