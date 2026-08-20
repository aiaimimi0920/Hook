// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";

import { JavaScriptSurface } from "../../src/components/JavaScriptSurface";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceSnapshot,
} from "../../src/services/surfaceProtocol";

const snapshot: SurfaceSnapshot = {
    protocolVersion: SURFACE_PROTOCOL_VERSION,
    instanceId: "instance:compact-drag",
    attachmentId: "attachment:compact-drag",
    artId: "neuro.official/compact-drag",
    artVersion: "1.0.0",
    revision: 1,
    scene: { id: "root", type: "view" },
};

describe("JavaScript Surface host interaction", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it.each([
        { interactive: false, expectedHostMouseDowns: 1, label: "compact" },
        { interactive: true, expectedHostMouseDowns: 0, label: "full" },
    ])("keeps $label Art pointer ownership aligned with sticker dragging", ({
        interactive,
        expectedHostMouseDowns,
    }) => {
        const mount = document.createElement("div");
        document.body.append(mount);
        let hostMouseDowns = 0;
        const dispose = render(
            () => (
                <div onMouseDown={() => {
                    hostMouseDowns += 1;
                }}>
                    <JavaScriptSurface
                        unitId="unit:compact-drag"
                        snapshot={snapshot}
                        generation={1}
                        lifecycle="active"
                        interactive={interactive}
                        resolveResource={() => undefined}
                        onEvent={() => undefined}
                    />
                </div>
            ),
            mount,
        );

        mount.querySelector(".javascript-surface-host")?.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );

        expect(hostMouseDowns).toBe(expectedHostMouseDowns);
        dispose();
    });
});
