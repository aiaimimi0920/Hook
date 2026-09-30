export const LIVE_EXTENSION_PROTOCOL_VERSION = "hook.live.extensions.v1" as const;

export type LiveExtensionKind = "application_adapter" | "visual_observation" | "interaction";
export type LiveExtensionAvailability = "available" | "unavailable";
export type LiveExtensionOwner = "loom_capability_plugin" | "hook_windows_backend";
export type LiveExtensionTrustBoundary = "loom_verified_capability_package" | "hook_native_backend";

export interface LiveExtensionCapability {
    id: string;
    kind: LiveExtensionKind;
    availability: LiveExtensionAvailability;
    executionOwner: LiveExtensionOwner;
    trustBoundary: LiveExtensionTrustBoundary;
    observationSource?: "app_adapter" | "vision";
    maximumConfidence?: "exact" | "high" | "medium" | "low";
    reason?: string;
}

export interface LiveExtensionCapabilityReport {
    protocolVersion: typeof LIVE_EXTENSION_PROTOCOL_VERSION;
    capabilities: LiveExtensionCapability[];
}

const adapter = (id: string): LiveExtensionCapability => ({
    id,
    kind: "application_adapter",
    availability: "unavailable",
    executionOwner: "loom_capability_plugin",
    trustBoundary: "loom_verified_capability_package",
    observationSource: "app_adapter",
    maximumConfidence: "exact",
    reason: "adapter_package_not_installed",
});

const interaction = (id: string): LiveExtensionCapability => ({
    id,
    kind: "interaction",
    availability: "unavailable",
    executionOwner: "hook_windows_backend",
    trustBoundary: "hook_native_backend",
    reason: "backend_not_implemented",
});

export const unavailableLiveExtensionReport: LiveExtensionCapabilityReport = {
    protocolVersion: LIVE_EXTENSION_PROTOCOL_VERSION,
    capabilities: [
        adapter("browser_accessibility"),
        adapter("electron_accessibility"),
        adapter("special_rendering"),
        {
            id: "vision_observation",
            kind: "visual_observation",
            availability: "unavailable",
            executionOwner: "loom_capability_plugin",
            trustBoundary: "loom_verified_capability_package",
            observationSource: "vision",
            maximumConfidence: "high",
            reason: "vision_provider_not_installed",
        },
        interaction("touch_input"),
        interaction("pen_input"),
        interaction("ime_input"),
        interaction("clipboard_input"),
        interaction("file_drop_input"),
    ],
};

export function parseLiveExtensionCapabilityReport(input: unknown): LiveExtensionCapabilityReport {
    const report = record(input, "live extension report");
    exactKeys(report, ["protocolVersion", "capabilities"]);
    if (report.protocolVersion !== LIVE_EXTENSION_PROTOCOL_VERSION) {
        throw new Error("unsupported live extension protocol version");
    }
    if (!Array.isArray(report.capabilities) || report.capabilities.length > 32) {
        throw new Error("invalid live extension capability list");
    }
    const ids = new Set<string>();
    const capabilities = report.capabilities.map((inputCapability) => {
        const capability = parseCapability(inputCapability);
        if (ids.has(capability.id)) throw new Error("duplicate live extension capability id");
        ids.add(capability.id);
        return capability;
    });
    return { protocolVersion: LIVE_EXTENSION_PROTOCOL_VERSION, capabilities };
}

function parseCapability(input: unknown): LiveExtensionCapability {
    const value = record(input, "live extension capability");
    exactKeys(
        value,
        ["id", "kind", "availability", "executionOwner", "trustBoundary"],
        ["observationSource", "maximumConfidence", "reason"],
    );
    if (typeof value.id !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(value.id)) {
        throw new Error("invalid live extension capability id");
    }
    member(value.kind, ["application_adapter", "visual_observation", "interaction"], "kind");
    member(value.availability, ["available", "unavailable"], "availability");
    member(value.executionOwner, ["loom_capability_plugin", "hook_windows_backend"], "owner");
    member(value.trustBoundary, ["loom_verified_capability_package", "hook_native_backend"], "trust boundary");
    if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 160 || value.reason.length === 0)) {
        throw new Error("invalid live extension capability reason");
    }
    if (value.availability === "unavailable" && value.reason === undefined) {
        throw new Error("unavailable live extension capability requires a reason");
    }
    if (value.kind === "interaction") {
        if (value.executionOwner !== "hook_windows_backend" || value.trustBoundary !== "hook_native_backend"
            || value.observationSource !== undefined || value.maximumConfidence !== undefined) {
            throw new Error("invalid live interaction extension boundary");
        }
    } else {
        const expectedSource = value.kind === "application_adapter" ? "app_adapter" : "vision";
        if (value.executionOwner !== "loom_capability_plugin"
            || value.trustBoundary !== "loom_verified_capability_package"
            || value.observationSource !== expectedSource) {
            throw new Error("live observation extensions require the Loom package trust boundary");
        }
        member(value.maximumConfidence, ["exact", "high", "medium", "low"], "maximum confidence");
        if (value.kind === "visual_observation" && value.maximumConfidence === "exact") {
            throw new Error("visual live extensions cannot claim exact confidence");
        }
    }
    return value as unknown as LiveExtensionCapability;
}

function record(input: unknown, name: string): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(`invalid ${name}`);
    return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
        throw new Error("invalid live extension fields");
    }
}

function member(input: unknown, values: readonly string[], name: string): void {
    if (typeof input !== "string" || !values.includes(input)) throw new Error(`invalid live extension ${name}`);
}
