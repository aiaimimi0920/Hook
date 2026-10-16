import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnitSurfaceContent } from "../../src/features/surfaces/components/UnitSurfaceContent";
import type { SurfaceViewState } from "../../src/features/surfaces/state/surfaceStore";
import type { Unit } from "../../src/features/workspace/types/unit";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), update: vi.fn(), units: [] as Unit[] }));
vi.mock("../../src/integrations/loom/client", () => ({ loomOtter: { dispatchSurfaceEvent: mocks.dispatch } }));
vi.mock("../../src/features/workspace/state/graphStore", () => ({ graphStore: {
    units: mocks.units, actions: { updateUnitData: mocks.update },
} }));
vi.mock("../../src/features/surfaces/components/DeclarativeSurface", () => ({ DeclarativeSurface: (props: {
    onEvent: (event: unknown) => void;
}) => <button onClick={() => props.onEvent({})}>Dispatch</button> }));

let dispose: (() => void) | undefined;
const unit: Unit = { id: "surface-error", type: "art", x: 0, y: 0, w: 100, h: 80,
    data: {}, params: {}, inputs: [], outputs: [] };
const mount = () => {
    const host = document.createElement("div");
    document.body.append(host);
    const surface = { generation: 1, snapshot: { runtime: "declarative" } } as SurfaceViewState;
    dispose = render(() => <UnitSurfaceContent unit={unit} surface={surface}
        isMinified={false} isShaderArt={false} minifiedViewport={{ width: 100, height: 80, offsetX: 0, offsetY: 0 }}
        effectiveParams={{}} holdFallbackPreview={false} requiresReference={false}
        allowContainerMouseDown={false} onActivate={() => undefined} onMouseDown={() => undefined}
        onIntrinsicSizeChange={() => undefined} onRendered={() => undefined} />, host);
    document.querySelector<HTMLButtonElement>("button")!.click();
};
beforeEach(() => { mocks.dispatch.mockReset(); mocks.update.mockReset(); mocks.units.splice(0, Infinity, unit); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); mocks.units.length = 0; });

describe("Surface native error reporting", () => {
    it.each(["Surface convergence stream returned 403 Forbidden", new Error("action failed")])(
        "preserves a sanitized native string or Error instead of hiding the actual failure", async (error) => {
            mocks.dispatch.mockRejectedValue(error);
            mount();
            await Promise.resolve();
            expect(mocks.update).toHaveBeenCalledWith(unit.id, {
                nodeStatus: "error", errorMessage: typeof error === "string" ? error : error.message,
            });
        },
    );
    it("ignores a late rejection after the owning Unit is removed", async () => {
        let reject!: (error: unknown) => void;
        mocks.dispatch.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
        mount();
        mocks.units.length = 0;
        reject("old error");
        await Promise.resolve();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
