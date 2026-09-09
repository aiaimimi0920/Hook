import { safeInvoke } from "./apiTransport";
import type { LiveCaptureInputRequest } from "./liveCapture";
import type {
    LiveRelayDiscovery,
    LiveRelayPollResponse,
    LiveRelaySnapshot,
    LiveRelayTriggerConfigureRequest,
} from "./liveRelay";
import {
    parseLiveExtensionCapabilityReport,
    unavailableLiveExtensionReport,
    type LiveExtensionCapabilityReport,
} from "./liveExtensions";
import {
    parseLiveNetworkCapabilityReport,
    unavailableLiveNetworkReport,
    type LiveNetworkCapabilityReport,
} from "./liveNetworkCapabilities";

export const liveRelayApi = {
    getLiveNetworkCapabilities: async (): Promise<LiveNetworkCapabilityReport> =>
        parseLiveNetworkCapabilityReport(await safeInvoke<unknown>(
            "get_live_network_capabilities",
            {},
            () => unavailableLiveNetworkReport,
            false,
        )),

    getLiveExtensionCapabilities: async (): Promise<LiveExtensionCapabilityReport> =>
        parseLiveExtensionCapabilityReport(await safeInvoke<unknown>(
            "get_live_extension_capabilities",
            {},
            () => unavailableLiveExtensionReport,
            false,
        )),

    publishLiveCaptureToLoom: (request: {
        captureSessionId: string;
        surfaceInstanceId: string;
        sourceAttachmentId: string;
        sourceHookId: string;
        liveSessionId?: string;
    }): Promise<LiveRelaySnapshot> => safeInvoke("publish_live_capture_to_loom", { request }),

    discoverLiveRelaySessions: (): Promise<LiveRelayDiscovery> =>
        safeInvoke("discover_live_relay_sessions", {}),

    joinLiveRelaySession: (request: {
        liveSessionId: string;
        surfaceInstanceId: string;
        attachmentId: string;
    }): Promise<LiveRelaySnapshot> => safeInvoke("join_live_relay_session", { request }),

    getLiveRelayStatus: (relayId: string): Promise<LiveRelaySnapshot> =>
        safeInvoke("get_live_relay_status", { relayId }),

    configureLiveRelayTrigger: (
        request: LiveRelayTriggerConfigureRequest,
    ): Promise<LiveRelaySnapshot> => safeInvoke("configure_live_relay_trigger", { request }),

    pollLiveRelayFrame: (relayId: string, afterFrameId: number): Promise<LiveRelayPollResponse> =>
        safeInvoke("poll_live_relay_frame", { relayId, afterFrameId }),

    readLiveRelayFrame: async (relayId: string, frameId: number): Promise<Uint8Array> => {
        const response = await safeInvoke<ArrayBuffer | Uint8Array>(
            "read_live_relay_frame",
            { relayId, frameId },
        );
        return response instanceof Uint8Array ? response : new Uint8Array(response);
    },

    changeLiveRelayController: (
        relayId: string,
        action: "acquire" | "release",
        leaseDurationMs?: number,
    ): Promise<LiveRelaySnapshot> => safeInvoke("change_live_relay_controller", {
        request: { relayId, action, leaseDurationMs },
    }),

    sendLiveRelayInput: (
        relayId: string,
        input: LiveCaptureInputRequest,
    ): Promise<LiveRelaySnapshot> => safeInvoke("send_live_relay_input", {
        request: { relayId, input },
    }),

    reclaimLiveRelayControl: (relayId: string): Promise<LiveRelaySnapshot> =>
        safeInvoke("reclaim_live_relay_control", { relayId }),

    reconnectLiveRelaySession: (relayId: string): Promise<LiveRelaySnapshot> =>
        safeInvoke("reconnect_live_relay_session", { relayId }),

    stopLiveRelaySession: (relayId: string): Promise<void> =>
        safeInvoke("stop_live_relay_session", { relayId }),
};
