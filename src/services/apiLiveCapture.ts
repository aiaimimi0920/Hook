import { safeInvoke } from "./apiTransport";
import type {
    LiveCapturePollResponse,
    LiveCaptureInputRequest,
    LiveCaptureStartRequest,
    LiveCaptureStatus,
} from "./liveCapture";

export const liveCaptureApi = {
    startLiveCapture: (request: LiveCaptureStartRequest): Promise<LiveCaptureStatus> =>
        safeInvoke("start_live_capture", { request }),

    getLiveCaptureStatus: (sessionId: string): Promise<LiveCaptureStatus> =>
        safeInvoke("get_live_capture_status", { sessionId }),

    pollLiveCaptureFrame: (sessionId: string, afterFrameId: number): Promise<LiveCapturePollResponse> =>
        safeInvoke("poll_live_capture_frame", { sessionId, afterFrameId }),

    readLiveCaptureFrame: async (sessionId: string, frameId: number): Promise<Uint8Array<ArrayBuffer>> => {
        const response = await safeInvoke<ArrayBuffer | Uint8Array<ArrayBuffer>>(
            "read_live_capture_frame",
            { sessionId, frameId },
        );
        return response instanceof Uint8Array ? response : new Uint8Array(response);
    },

    setLiveCaptureSourceHidden: (sessionId: string, hidden: boolean): Promise<LiveCaptureStatus> =>
        safeInvoke("set_live_capture_source_hidden", { sessionId, hidden }),

    setLiveCaptureInteractionEnabled: (sessionId: string, enabled: boolean): Promise<LiveCaptureStatus> =>
        safeInvoke("set_live_capture_interaction_enabled", { sessionId, enabled }),

    sendLiveCaptureInput: (sessionId: string, request: LiveCaptureInputRequest): Promise<void> =>
        safeInvoke("send_live_capture_input", { sessionId, request }),

    stopLiveCapture: (sessionId: string): Promise<void> =>
        safeInvoke("stop_live_capture", { sessionId }),
};
