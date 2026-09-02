import { describe, expect, it } from "vitest";

import { resolveOcrSurfaceTypography } from "../../src/services/ocrSurfaceTypography";

describe("OCR declarative surface typography", () => {
    it("caps long text by width while preserving source line height", () => {
        const style = resolveOcrSurfaceTypography(
            "require_trusted",
            120,
            24,
            900,
            350,
        );

        expect(style.fontSize).toMatch(/^min\(\d+\.\d{4}cqh, \d+\.\d{4}cqw\)$/);
        expect(style.lineHeight).toBe("6.8571cqh");
    });

    it("uses the longest visual line for multiline width fitting", () => {
        const short = resolveOcrSurfaceTypography("短\n文本", 100, 20, 400, 200);
        const long = resolveOcrSurfaceTypography("短\n这是一条更长的文本", 100, 20, 400, 200);

        expect(Number(long.fontSize.match(/, ([\d.]+)cqw/)?.[1]))
            .toBeLessThan(Number(short.fontSize.match(/, ([\d.]+)cqw/)?.[1]));
    });
});
