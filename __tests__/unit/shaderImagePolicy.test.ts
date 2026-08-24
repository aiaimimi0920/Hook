// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
    isShaderImageSizeWithinBudget,
    resolveShaderBrowserImageUrl,
} from "../../src/services/shaderImagePolicy";

describe("shader image policy", () => {
    afterEach(() => {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it("accepts supported image sizes and rejects invalid or excessive allocations", () => {
        expect(isShaderImageSizeWithinBudget(3840, 2160)).toBe(true);
        expect(isShaderImageSizeWithinBudget(8192, 4096)).toBe(true);
        expect(isShaderImageSizeWithinBudget(8192, 4097)).toBe(false);
        expect(isShaderImageSizeWithinBudget(8193, 1)).toBe(false);
        expect(isShaderImageSizeWithinBudget(1025, 1, 1024)).toBe(false);
        expect(isShaderImageSizeWithinBudget(0, 1)).toBe(false);
        expect(isShaderImageSizeWithinBudget(Number.NaN, 1)).toBe(false);
        expect(isShaderImageSizeWithinBudget(Number.POSITIVE_INFINITY, 1)).toBe(false);
    });

    it("allows supported image URLs and rejects executable or non-image schemes", () => {
        expect(resolveShaderBrowserImageUrl(" data:image/png;base64,PNG ")).toBe("data:image/png;base64,PNG");
        expect(resolveShaderBrowserImageUrl("data:image/jpeg;base64,JPEG")).toBe("data:image/jpeg;base64,JPEG");
        expect(resolveShaderBrowserImageUrl("blob:https://localhost/id")).toBe("blob:https://localhost/id");
        expect(resolveShaderBrowserImageUrl("asset://localhost/image.png")).toBe("asset://localhost/image.png");
        expect(resolveShaderBrowserImageUrl("https://example.test/image.png")).toBe("https://example.test/image.png");
        expect(resolveShaderBrowserImageUrl("/images/input.png")).toBe("/images/input.png");
        expect(resolveShaderBrowserImageUrl("javascript:alert(1)")).toBe("");
        expect(resolveShaderBrowserImageUrl("VBScript:msgbox(1)")).toBe("");
        expect(resolveShaderBrowserImageUrl("data:text/html,<script></script>")).toBe("");
        expect(resolveShaderBrowserImageUrl("data:image/svg+xml,<svg></svg>")).toBe("");
        expect(resolveShaderBrowserImageUrl("file:///tmp/image.png")).toBe("");
        expect(resolveShaderBrowserImageUrl("ftp://example.test/image.png")).toBe("");
        expect(resolveShaderBrowserImageUrl("//example.test/image.png")).toBe("");
    });

    it("converts desktop file paths only inside the Tauri runtime", () => {
        (window as Window & {
            __TAURI_INTERNALS__?: { convertFileSrc: (path: string, protocol?: string) => string };
        }).__TAURI_INTERNALS__ = {
            convertFileSrc: (path: string) => `asset://localhost/${path.replace(/\\/g, "/")}`,
        };

        expect(resolveShaderBrowserImageUrl("C:\\images\\input.png"))
            .toBe("asset://localhost/C:/images/input.png");
    });
});
