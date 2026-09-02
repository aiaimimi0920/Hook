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
        }, false),
};

export const loomProtocolApi = {
    handshake: (request: HandshakeRequest): Promise<HandshakeResponse> =>
        safeInvoke("loom_hook_handshake", { request }, browserHandshakeFallback, false),

    dispatchAction: (actionEnum: { action: string; payload: unknown }): Promise<void> =>
        safeInvoke(
            "loom_hook_dispatch_action",
            { action: actionEnum },
            () => browserDispatchActionFallback(actionEnum),
            false,
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
        }), false),

};
