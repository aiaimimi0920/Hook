import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { UnitStickerImageContent } from "../../src/components/UnitStickerImageContent";
import { attachLiveCaptureUnit, detachLiveCaptureUnit } from "../../src/services/liveCaptureUnit";
import { graphStore } from "../../src/store/graphStore";
import { liveCaptureActions, liveCaptureViews } from "../../src/store/liveCaptureStore";
import { liveUnitStatus } from "../fixtures/liveUnit";

const invoke = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: invoke, isTauriRuntimeAvailable: () => true }));
let dispose: (() => void) | undefined;
afterEach(() => {
    dispose?.();
    detachLiveCaptureUnit("live-runtime-test");
    liveCaptureActions.clear();
    graphStore.actions.replaceUnits([]);
    document.body.replaceChildren();
});
it("registers native capability from the real image component and Live stores", async () => {
    liveCaptureActions.add(liveUnitStatus(), { x: 20, y: 30, width: 200, height: 100 });
    attachLiveCaptureUnit(liveCaptureViews[0], async () => undefined);
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => <UnitStickerImageContent unit={graphStore.units[0]}
        hasDeclarativeSurface={false} isShaderArt={false} isMinified={false}
        minifiedAnnotationViewport={{ width: 200, height: 100, offsetX: 0, offsetY: 0 }}
        imageContentFrame={{ x: 0, y: 0, w: 200, h: 100 }}
        minifiedViewport={{ width: 200, height: 100, offsetX: 0, offsetY: 0 }}
        croppedImageViewport={null} transform="none" baseImageSrc="" browserDragEnabled={false}
        onBrowserDragStart={() => undefined} onBaseImageLoad={() => undefined} onImageError={() => undefined}
        imageBorderWidth={0} imageBorderColor="" cornerRadius={0}
    />, host);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("get_live_gpu_preview_capability", undefined));
});
