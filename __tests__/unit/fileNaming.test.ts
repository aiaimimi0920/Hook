import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    renderFileNamingStem,
    sanitizeWindowsFilenameStem,
    validateFileNamingPattern,
} from "../../src/services/fileNaming";
import { DEFAULT_FILE_NAMING_SETTINGS } from "../../src/types/fileNaming";

type Fixture = {
    render: {
        pattern: string;
        context: Record<string, string | number>;
        moment: {
            year: number;
            month: number;
            day: number;
            hour: number;
            minute: number;
            second: number;
            millisecond: number;
        };
        expected: string;
    };
    sanitize: Array<{ input: string; expected: string }>;
    invalidPatterns: string[];
};

const fixture = JSON.parse(
    readFileSync(
        resolve(process.cwd(), "__tests__/fixtures/file-naming-cases.json"),
        "utf8",
    ),
) as Fixture;

describe("file naming", () => {
    it("renders the shared Unicode placeholder fixture", () => {
        const moment = fixture.render.moment;
        const now = new Date(
            moment.year,
            moment.month - 1,
            moment.day,
            moment.hour,
            moment.minute,
            moment.second,
            moment.millisecond,
        );
        expect(
            renderFileNamingStem(
                fixture.render.pattern,
                fixture.render.context,
                DEFAULT_FILE_NAMING_SETTINGS,
                now,
            ),
        ).toBe(fixture.render.expected);
    });

    it("matches the shared Windows sanitizer cases without removing normal Unicode", () => {
        for (const testCase of fixture.sanitize) {
            expect(sanitizeWindowsFilenameStem(testCase.input)).toBe(testCase.expected);
        }
    });

    it("rejects every invalid shared pattern", () => {
        for (const pattern of fixture.invalidPatterns) {
            expect(validateFileNamingPattern(pattern)).not.toBeNull();
        }
        expect(validateFileNamingPattern("Hook_{date}_{time}_{width}x{height}")).toBeNull();
    });

    it("limits the final filename stem by Unicode scalar count", () => {
        const result = sanitizeWindowsFilenameStem("图".repeat(160));
        expect(Array.from(result)).toHaveLength(120);
    });
});
