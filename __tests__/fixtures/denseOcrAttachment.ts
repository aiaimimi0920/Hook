const points = (left: number, top: number, width: number, height: number) => [
    { x: left, y: top }, { x: left + width, y: top },
    { x: left + width, y: top + height }, { x: left, y: top + height },
];

/** A normal page carries hundreds of CTC spans, independent of its Surface node count. */
export const denseOcrAttachmentPayload = () => {
    const textBlocks = Array.from({ length: 14 }, (_, index) => {
        const text = `Selectable OCR text on page line ${index + 1}`;
        const left = 16;
        const top = 20 + index * 42;
        const height = 32;
        const width = text.length * 10;
        const span = (value: string, offset: number) => ({
            text: value,
            boxPoints: points(left + offset * 10, top, value.length * 10, height),
            score: 0.9989345669746399,
            source: "ctcAlignedFromRecognitionTimesteps",
        });
        return {
            text, left, top, width, height,
            textColor: "#181818", colorHex: "#181818",
            backgroundColor: "#ffffff", bgColorHex: "#ffffff",
            boxPoints: points(left, top, width, height),
            boxScore: 0.99, textScore: 0.99,
            confidenceSource: "ctcDecodedSymbolScores",
            confidence: {
                meanSymbolScore: 0.99, minimumSymbolScore: 0.98,
                recoveredSymbolCount: 0, symbolCount: text.length,
                source: "ctcDecodedSymbolScores",
            },
            lineGeometry: {
                angleDegrees: 0,
                baseline: [{ x: left, y: top + height }, { x: left + width, y: top + height }],
                source: "estimatedFromRapidOcrLineQuad",
            },
            characterSpans: [...text].map((character, offset) => span(character, offset)),
            wordSpans: [...text.matchAll(/\S+/gu)].map((match) => span(match[0], match.index)),
        };
    });
    return {
        schemaVersion: "1", visible: true, showTranslated: false,
        sourceWidth: 720, sourceHeight: 640, coordinateScale: 1,
        fullText: textBlocks.map((block) => block.text).join("\n"),
        textBlocks,
        surfaceScene: {
            id: "ocr-overlay-root", type: "stack", props: { visible: true },
            layout: { position: "relative", width: "100%", height: "100%" },
            children: textBlocks.map((block, index) => ({
                id: `ocr-block-${index}`, type: "stack",
                props: { eventPayload: { text: block.text, blockIndex: index } },
                layout: {
                    position: "absolute", left: `${block.left / 720 * 100}%`,
                    top: `${block.top / 640 * 100}%`, width: `${block.width / 720 * 100}%`,
                    height: "5%",
                },
                events: { click: "neuro.official/ocr.copy-block" },
                children: [{
                    id: `ocr-text-${index}`, type: "text",
                    props: { text: block.text, selectable: true },
                }],
            })),
        },
    };
};
