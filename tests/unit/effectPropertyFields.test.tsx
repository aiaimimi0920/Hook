// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerTopStripPropertyBar } from "../../src/features/stickers/components/StickerTopStripPropertyBar";
import { stickerToolSettings, uiActions } from "../../src/features/workspace/state/uiStore";

let host: HTMLDivElement;
let dispose: () => void;
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const enter = (label: string, value: string) => {
    const input = field(label); input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};
beforeEach(() => {
    host = document.createElement("div"); document.body.append(host);
    uiActions.patchStickerToolSettings({ effectBrushSize: 28, mosaicSize: 12, blurStrength: 8 });
});
afterEach(() => { dispose(); host.remove(); });

describe("compact mosaic and blur property bars", () => {
    it.each(["mosaic", "blur"] as const)("uses compact controls and preserves %s limits", (tool) => {
        dispose = render(() => <StickerTopStripPropertyBar unitId="effect-preview" tool={tool} />, host);
        expect(host.querySelector(".otter-rectangle-properties")).not.toBeNull();
        expect(host.querySelectorAll(".rectangle-number")).toHaveLength(2);
        expect(host.querySelectorAll(".rectangle-steppers button")).toHaveLength(4);
        const label = tool === "mosaic" ? "色块大小" : "模糊强度";
        enter("笔刷大小", "123"); expect(stickerToolSettings.effectBrushSize).toBe(123);
        enter("笔刷大小", "999"); expect(stickerToolSettings.effectBrushSize).toBe(200);
        enter(label, "999");
        expect(tool === "mosaic" ? stickerToolSettings.mosaicSize : stickerToolSettings.blurStrength).toBe(64);
        enter(label, "0"); expect(field(label).value).toBe("2");
        host.querySelector<HTMLButtonElement>(`[aria-label="增加${label}"]`)!.click();
        expect(field(label).value).toBe("3");
        host.querySelector<HTMLButtonElement>(`[aria-label="减少${label}"]`)!.click();
        expect(field(label).value).toBe("2");
        enter(label, ""); expect(field(label).value).toBe("2");
    });
    it("switches icons and settings without changing the other effect", () => {
        const [tool, setTool] = createSignal<"mosaic" | "blur">("mosaic");
        dispose = render(() => <StickerTopStripPropertyBar unitId="effect-preview" tool={tool()} />, host);
        expect(host.querySelectorAll(".rectangle-number-icon rect")).toHaveLength(4);
        enter("色块大小", "24"); setTool("blur");
        expect(field("色块大小")).toBeNull(); expect(field("模糊强度").value).toBe("8");
        expect(host.querySelectorAll(".rectangle-number-icon rect")).toHaveLength(0);
        enter("模糊强度", "16");
        expect(stickerToolSettings.mosaicSize).toBe(24); expect(stickerToolSettings.blurStrength).toBe(16);
    });
});
