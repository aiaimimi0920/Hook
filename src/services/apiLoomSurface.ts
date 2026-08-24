// Routes Loom/Surface protocol commands without owning the browser sockets or native resources.
import type { ShaderResponse } from "../components/ShaderRenderer";
import { browserDispatchActionFallback } from "./apiBrowserArt";
import {
    browserHandshakeFallback,
    loomHookRequest,
} from "./apiBrowserLoomTransport";
import { safeInvoke } from "./apiTransport";
import type {
    EnhancementCapabilities,
    LoomBrainPlanRequest,
    LoomBrainPlanResult,
    OcrResult,
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

export const loomEnhancementApi = {
    prefetchShader: (args: {
        artId: string;
        inputPath: string | null;
        referencePath: string | null;
    }): Promise<ShaderResponse> =>
        safeInvoke("prefetch_shader", args, () => ({
            type: "unsupported",
            success: false,
        }), false),

    getEnhancementCapabilities: (): Promise<EnhancementCapabilities> =>
        loomHookRequest<EnhancementCapabilities>("loom.hook.enhancements.get", {
            requestId: `enhancements:${crypto.randomUUID()}`,
        }).catch(() => ({
            ocr: false,
            translation: false,
        })),

    performOcr: (imageBase64: string): Promise<OcrResult> =>
        loomHookRequest("loom.hook.ocr.execute", {
            requestId: `ocr:${crypto.randomUUID()}`,
            imageBase64,
        }),

    translateText: (text: string, targetLang: string): Promise<string> =>
        loomHookRequest<{ translatedText: string }>("loom.hook.translation.execute", {
            requestId: `translation:${crypto.randomUUID()}`,
            text,
            targetLanguage: targetLang,
        }).then((result) => result.translatedText),

    triggerOcrEvent: (): Promise<void> =>
        safeInvoke("trigger_ocr_event", undefined, () => undefined, false),
};
