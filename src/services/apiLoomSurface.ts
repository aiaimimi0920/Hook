// Routes Loom/Surface protocol commands without owning the browser sockets or native resources.
import type { ShaderResponse } from "../components/ShaderRenderer";
import { browserDispatchActionFallback } from "./apiBrowserArt";
import { browserHandshakeFallback } from "./apiBrowserLoomTransport";
import { safeInvoke } from "./apiTransport";
import type {
    LoomBrainPlanRequest,
    LoomBrainPlanResult,
} from "./apiTypes";
import type { HandshakeRequest, HandshakeResponse } from "./protocol";

export const loomPlanningApi = {
    invokeLoomBrainPlan: (request: LoomBrainPlanRequest): Promise<LoomBrainPlanResult> =>
        safeInvoke("loom_brain_plan", { request }, () => {
            throw new Error("Loom brain planning requires the Tauri desktop runtime");
        }),
};

export const loomProtocolApi = {
    handshake: (request: HandshakeRequest): Promise<HandshakeResponse> =>
        safeInvoke("loom_otter_handshake", { request }, browserHandshakeFallback),

    dispatchAction: (actionEnum: { action: string; payload: unknown }): Promise<void> =>
        safeInvoke(
            "loom_otter_dispatch_action",
            { action: actionEnum },
            () => browserDispatchActionFallback(actionEnum),
        ),
};

export const loomShaderApi = {
    prefetchShader: (args: {
        artId: string;
        inputPath: string | null;
        referencePath: string | null;
    }): Promise<ShaderResponse> =>
        safeInvoke("prefetch_shader", args, () => ({
            type: "unsupported",
            success: false,
        })),

};
