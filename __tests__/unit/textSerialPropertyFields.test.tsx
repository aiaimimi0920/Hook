// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createRoot } from "solid-js";
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerTopStripPropertyBar } from "../../src/components/StickerTopStripPropertyBar";
import { graphStore } from "../../src/store/graphStore";
import { stickerToolSettings, uiActions, stickerEditHistories } from "../../src/store/uiStore";
import { buildSerialAnnotationMetrics } from "../../src/services/stickerStyleValues";
import { createStickerAnnotationTextController } from "../../src/components/stickerAnnotationTextController";
import { TextToolIcon } from "../../src/components/stickerTopStripIcons";
import { getAnnotationBounds } from "../../src/services/stickerAnnotationBounds";
import { getTextLineMetrics, TEXT_FRAME_PADDING } from "../../src/services/stickerTextGeometry";
import type { StickerTextAnnotation } from "../../src/types/stickerEditing";

const id = "text-serial-properties";
let dispose: () => void;
let host: HTMLDivElement;
const annotation = (type: "text" | "serial"): StickerTextAnnotation => ({
    id: "annotation", type, zIndex: 0, x: 10, y: 10, text: "1", fontSize: 24, fontFamily: "Arial",
    style: { color: "#ffffff", fill: "#00000000", width: 2, cornerRadius: 18 },
});
const mount = (tool: "text" | "serial" | "selected-text" | "selected-serial") => {
    dispose = render(() => <StickerTopStripPropertyBar unitId={id} tool={tool} />, host);
};
const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const enter = (label: string, value: string) => {
    const field = input(label); field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};
beforeEach(() => {
    host = document.createElement("div"); document.body.append(host);
    graphStore.actions.addUnit({ id, type: "sticker", x: 0, y: 0, w: 500, h: 300, params: {}, inputs: [], outputs: [], data: { annotationState: { elements: [], serialCounter: 1 } } });
    uiActions.patchStickerToolSettings({ textSize: 24, serialRadius: 18, textColor: "#ffffff00" });
    uiActions.clearStickerHistory(id);
});
afterEach(() => { dispose?.(); graphStore.actions.removeUnit(id); uiActions.setSelectedStickerAnnotation(null); uiActions.clearStickerHistory(id); host.remove(); });

describe("compact text and serial properties", () => {
    it.each([24, 120, 999])("keeps the input anchored to the SVG text origin at size %s", (fontSize) => {
        createRoot((cleanup) => {
            const controller = createStickerAnnotationTextController({
                width: () => 550, height: () => 270,
                annotationState: () => ({ elements: [], serialCounter: 1 }),
                commitAnnotation: vi.fn(async () => {}), patchUnitData: vi.fn(async () => {}), rememberCurrentState: vi.fn(),
            });
            controller.setPendingTextInput({ x: 200, y: 50, value: "", fontSize, fontFamily: "Arial", color: "#ffffff" });
            for (const value of ["", "文", "文本测试".repeat(20), "短文本"]) {
                controller.setPendingTextInput((draft) => draft ? { ...draft, value } : draft);
                const style = controller.pendingTextInputStyle();
                expect(style.left).toBe("196px");
                const line = getTextLineMetrics(fontSize, "Arial");
                expect(style.top).toBe(`${50 - line.baselineOffset - line.height / 2}px`);
                expect(parseFloat(style.left!) + 1 + Number(style.padding!.split(" ")[1].replace("px", ""))).toBe(200);
                expect(style.height).toBe(`${line.height}px`);
                if (value.length > 20) expect(parseFloat(style.width!)).toBeGreaterThan(350);
            }
            const saved: StickerTextAnnotation = { ...annotation("text"), x: 200, y: 50, text: "短文本", fontSize };
            const bounds = getAnnotationBounds(saved);
            controller.setPendingTextInput({ annotationId: saved.id, x: saved.x, y: saved.y,
                value: saved.text, fontSize, fontFamily: "Arial", color: "#ffffff" });
            const editing = controller.pendingTextInputStyle();
            expect(parseFloat(editing.left!)).toBe(bounds.x - TEXT_FRAME_PADDING);
            expect(parseFloat(editing.top!)).toBe(bounds.y);
            expect(parseFloat(editing.width!)).toBe(bounds.w + TEXT_FRAME_PADDING * 2);
            expect(parseFloat(editing.height!)).toBe(bounds.h);
            uiActions.patchStickerToolSettings({ textSize: fontSize });
            controller.beginPendingTextInput({ x: 230, y: 140 });
            for (const value of ["", "你好", "ABC", "gy", "23"]) {
                controller.setPendingTextInput((draft) => draft ? { ...draft, value } : draft);
                const frame = controller.pendingTextInputStyle();
                expect(frame.left).toBe("230px");
                expect(parseFloat(frame.top!) + parseFloat(frame.height!) / 2).toBe(140);
                expect(frame.height).toBe(`${getTextLineMetrics(fontSize, stickerToolSettings.textFontFamily).height}px`);
            }
            cleanup();
        });
    });
    it("reuses the main toolbar T for the font selector", () => {
        mount("text");
        const reference = document.createElement("div");
        const cleanup = render(() => <TextToolIcon />, reference);
        expect(host.querySelector(".text-serial-font svg")!.innerHTML).toBe(reference.querySelector("svg")!.innerHTML);
        cleanup();
    });
    it("starts with eight full-width characters and grows or shrinks with input", () => {
        createRoot((cleanup) => {
            const controller = createStickerAnnotationTextController({
                width: () => 640, height: () => 480,
                annotationState: () => ({ elements: [], serialCounter: 1 }),
                commitAnnotation: vi.fn(async () => {}), patchUnitData: vi.fn(async () => {}), rememberCurrentState: vi.fn(),
            });
            controller.setPendingTextInput({ x: 20, y: 40, value: "", fontSize: 16, fontFamily: "Arial", color: "#ffffff" });
            expect(controller.pendingTextInputStyle().width).toBe("136px");
            const update = (value: string) => controller.setPendingTextInput((draft) => draft ? { ...draft, value } : draft);
            update("长文本输入自动扩展横条宽度".repeat(4));
            expect(parseFloat(controller.pendingTextInputStyle().width!)).toBeGreaterThan(136);
            expect(parseFloat(controller.pendingTextInputStyle().width!)).toBeLessThanOrEqual(640);
            update("短文本"); expect(controller.pendingTextInputStyle().width).toBe("136px");
            update("文本".repeat(500));
            expect(parseFloat(controller.pendingTextInputStyle().width!)).toBeGreaterThan(620);
            expect(controller.pendingTextInputStyle().left).toBe("16px");
            cleanup();
        });
    });
    it("uses the shared compact shell, transparent swatch and three-digit text size stepper", () => {
        mount("text");
        expect(host.querySelector(".otter-rectangle-properties")).not.toBeNull();
        expect(host.querySelector(".rectangle-transparent-mark")).not.toBeNull();
        enter("字号", "999"); expect(stickerToolSettings.textSize).toBe(999);
        host.querySelector<HTMLButtonElement>('[aria-label="增加字号"]')!.click();
        expect(stickerToolSettings.textSize).toBe(999);
        host.querySelector<HTMLButtonElement>('[aria-label="减少字号"]')!.click();
        expect(stickerToolSettings.textSize).toBe(998);
        enter("字号", "0"); expect(stickerToolSettings.textSize).toBe(8);
    });
    it("puts fill before foreground and preserves three-digit serial geometry", () => {
        mount("serial");
        expect([...host.querySelectorAll(".rectangle-color")].map((el) => el.getAttribute("aria-label"))).toEqual(["填充颜色", "描边/数字颜色"]);
        enter("半径", "300"); expect(stickerToolSettings.serialRadius).toBe(300);
        expect(buildSerialAnnotationMetrics(300).radius).toBe(300);
        expect(buildSerialAnnotationMetrics(Infinity).radius).toBe(14);
        expect(buildSerialAnnotationMetrics(1000).radius).toBe(999);
    });
    it.each(["text", "serial"] as const)("edits selected %s without changing creation defaults", (type) => {
        graphStore.actions.updateUnitData(id, { annotationState: { elements: [annotation(type)], serialCounter: 2 } });
        uiActions.setSelectedStickerAnnotation("annotation");
        mount(type === "text" ? "selected-text" : "selected-serial");
        const label = type === "text" ? "字号" : "半径";
        enter(label, "250");
        const saved = graphStore.units.find((unit) => unit.id === id)!.data.annotationState!.elements[0] as StickerTextAnnotation;
        expect(type === "text" ? saved.fontSize : saved.style.cornerRadius).toBe(250);
        expect(stickerToolSettings.textSize).toBe(24);
        expect(stickerToolSettings.serialRadius).toBe(18);
        expect(stickerEditHistories[id].past).toHaveLength(1);
        enter(label, "250"); expect(stickerEditHistories[id].past).toHaveLength(1);
    });
});
