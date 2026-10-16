export const LIVE_NETWORK_PROTOCOL_VERSION = "hook.live.network.v1" as const;

export type LiveNetworkScope =
    | "loopback_http"
    | "loopback_https"
    | "private_https"
    | "unavailable";

export interface LiveNetworkTransportCapability {
    id: "websocket_binary" | "cloud_relay" | "webrtc_turn";
    availability: "available" | "unavailable";
    reason?: string;
}

export interface LiveNetworkCapabilityReport {
    protocolVersion: typeof LIVE_NETWORK_PROTOCOL_VERSION;
    configuredScope: LiveNetworkScope;
    baseUrlOrigin?: string;
    remoteSurfaceEnabled: boolean;
    lanIndependent: boolean;
    nonLoopbackTlsRequired: boolean;
    nonLoopbackDeviceAuthRequired: boolean;
    latencyTelemetry: "viewer_websocket_ping_round_trip";
    inputPolicy: "rtt_adaptive_pointer_coalescing";
    transports: LiveNetworkTransportCapability[];
    privacy: {
        cloudFramePersistence: false;
        cloudOcrPersistence: false;
        telemetryEnabled: false;
        credentialsExposed: false;
        policy: "local_first_no_cloud_storage";
    };
}

export const unavailableLiveNetworkReport: LiveNetworkCapabilityReport = {
    protocolVersion: LIVE_NETWORK_PROTOCOL_VERSION,
    configuredScope: "unavailable",
    remoteSurfaceEnabled: false,
    lanIndependent: true,
    nonLoopbackTlsRequired: true,
    nonLoopbackDeviceAuthRequired: true,
    latencyTelemetry: "viewer_websocket_ping_round_trip",
    inputPolicy: "rtt_adaptive_pointer_coalescing",
    transports: [
        { id: "websocket_binary", availability: "unavailable", reason: "native_runtime_unavailable" },
        { id: "cloud_relay", availability: "unavailable", reason: "relay_provider_not_configured" },
        { id: "webrtc_turn", availability: "unavailable", reason: "nat_traversal_not_configured" },
    ],
    privacy: {
        cloudFramePersistence: false,
        cloudOcrPersistence: false,
        telemetryEnabled: false,
        credentialsExposed: false,
        policy: "local_first_no_cloud_storage",
    },
};

export function parseLiveNetworkCapabilityReport(input: unknown): LiveNetworkCapabilityReport {
    const report = record(input, "live network report");
    exactKeys(report, [
        "protocolVersion", "configuredScope", "remoteSurfaceEnabled", "lanIndependent",
        "nonLoopbackTlsRequired", "nonLoopbackDeviceAuthRequired", "latencyTelemetry",
        "inputPolicy", "transports", "privacy",
    ], ["baseUrlOrigin"]);
    if (report.protocolVersion !== LIVE_NETWORK_PROTOCOL_VERSION) throw new Error("unsupported live network protocol");
    member(report.configuredScope, ["loopback_http", "loopback_https", "private_https", "unavailable"], "scope");
    for (const key of [
        "remoteSurfaceEnabled", "lanIndependent", "nonLoopbackTlsRequired", "nonLoopbackDeviceAuthRequired",
    ]) {
        if (typeof report[key] !== "boolean") throw new Error(`invalid live network ${key}`);
    }
    if (report.lanIndependent !== true || report.nonLoopbackTlsRequired !== true
        || report.nonLoopbackDeviceAuthRequired !== true) {
        throw new Error("live network security posture cannot be weakened");
    }
    if (report.latencyTelemetry !== "viewer_websocket_ping_round_trip"
        || report.inputPolicy !== "rtt_adaptive_pointer_coalescing") {
        throw new Error("invalid live network latency policy");
    }
    validateOrigin(report.baseUrlOrigin, report.configuredScope as LiveNetworkScope);
    if (!Array.isArray(report.transports) || report.transports.length !== 3) {
        throw new Error("invalid live network transport inventory");
    }
    const transports = report.transports.map(parseTransport);
    const ids = new Set(transports.map((transport) => transport.id));
    if (ids.size !== 3 || !["websocket_binary", "cloud_relay", "webrtc_turn"].every((id) => ids.has(id as LiveNetworkTransportCapability["id"]))) {
        throw new Error("incomplete or duplicate live network transport inventory");
    }
    const privacy = parsePrivacy(report.privacy);
    return { ...(report as unknown as LiveNetworkCapabilityReport), transports, privacy };
}

function parseTransport(input: unknown): LiveNetworkTransportCapability {
    const value = record(input, "live network transport");
    exactKeys(value, ["id", "availability"], ["reason"]);
    member(value.id, ["websocket_binary", "cloud_relay", "webrtc_turn"], "transport id");
    member(value.availability, ["available", "unavailable"], "transport availability");
    if (value.reason !== undefined && (typeof value.reason !== "string" || !/^[a-z][a-z0-9_]{0,159}$/.test(value.reason))) {
        throw new Error("invalid live network transport reason");
    }
    if (value.availability === "unavailable" && value.reason === undefined) {
        throw new Error("unavailable live network transport requires a reason");
    }
    if (value.availability === "available" && value.reason !== undefined) {
        throw new Error("available live network transport cannot have a denial reason");
    }
    return value as unknown as LiveNetworkTransportCapability;
}

function parsePrivacy(input: unknown): LiveNetworkCapabilityReport["privacy"] {
    const value = record(input, "live network privacy posture");
    exactKeys(value, [
        "cloudFramePersistence", "cloudOcrPersistence", "telemetryEnabled", "credentialsExposed", "policy",
    ]);
    if (value.cloudFramePersistence !== false || value.cloudOcrPersistence !== false
        || value.telemetryEnabled !== false || value.credentialsExposed !== false
        || value.policy !== "local_first_no_cloud_storage") {
        throw new Error("invalid live network privacy posture");
    }
    return value as unknown as LiveNetworkCapabilityReport["privacy"];
}

function validateOrigin(input: unknown, scope: LiveNetworkScope): void {
    if (scope === "unavailable") {
        if (input !== undefined) throw new Error("unavailable live network scope cannot expose an origin");
        return;
    }
    if (typeof input !== "string" || input.length > 2048) throw new Error("invalid live network origin");
    const url = new URL(input);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("live network endpoint must be an origin without credentials");
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv4 = hostname.split(".").map(Number);
    const loopback = hostname === "localhost" || hostname === "::1"
        || (ipv4.length === 4 && ipv4[0] === 127
            && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255));
    const matchesScope = scope === "loopback_http"
        ? url.protocol === "http:" && loopback
        : scope === "loopback_https"
            ? url.protocol === "https:" && loopback
            : url.protocol === "https:" && !loopback;
    if (!matchesScope) {
        throw new Error("live network origin does not match its configured scope");
    }
}

function record(input: unknown, name: string): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`invalid ${name}`);
    return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
        throw new Error("invalid live network fields");
    }
}

function member(input: unknown, values: readonly string[], name: string): void {
    if (typeof input !== "string" || !values.includes(input)) throw new Error(`invalid live network ${name}`);
}
