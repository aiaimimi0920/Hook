import { describe, expect, it } from "vitest";

import {
    parseLiveExtensionCapabilityReport,
    unavailableLiveExtensionReport,
} from "../../src/services/liveExtensions";

describe("hook.live.extensions.v1", () => {
    it("reports every unimplemented extension as unavailable with a reason", () => {
        const parsed = parseLiveExtensionCapabilityReport(unavailableLiveExtensionReport);
        expect(parsed.capabilities).toHaveLength(9);
        expect(new Set(parsed.capabilities.map((capability) => capability.id)).size).toBe(9);
        expect(parsed.capabilities.every((capability) =>
            capability.availability === "unavailable" && Boolean(capability.reason),
        )).toBe(true);
        expect(parsed.capabilities.filter((capability) => capability.kind === "interaction").map(
            (capability) => capability.id,
        )).toEqual(["touch_input", "pen_input", "ime_input", "clipboard_input", "file_drop_input"]);
    });

    it("keeps adapters behind Loom package trust", () => {
        const parsed = parseLiveExtensionCapabilityReport(unavailableLiveExtensionReport);
        const observations = parsed.capabilities.filter((capability) => capability.kind !== "interaction");
        expect(observations.every((capability) =>
            capability.executionOwner === "loom_capability_plugin"
            && capability.trustBoundary === "loom_verified_capability_package",
        )).toBe(true);
    });

    it("rejects visual exact confidence and native adapter bypasses", () => {
        const vision = unavailableLiveExtensionReport.capabilities.find(
            (capability) => capability.id === "vision_observation",
        );
        expect(() => parseLiveExtensionCapabilityReport({
            ...unavailableLiveExtensionReport,
            capabilities: [{ ...vision, maximumConfidence: "exact" }],
        })).toThrow(/cannot claim exact/);

        const adapter = unavailableLiveExtensionReport.capabilities[0];
        expect(() => parseLiveExtensionCapabilityReport({
            ...unavailableLiveExtensionReport,
            capabilities: [{
                ...adapter,
                executionOwner: "hook_windows_backend",
                trustBoundary: "hook_native_backend",
            }],
        })).toThrow(/Loom package trust/);
    });

    it("rejects duplicate IDs, unknown fields, and missing denial reasons", () => {
        const capability = unavailableLiveExtensionReport.capabilities[0];
        expect(() => parseLiveExtensionCapabilityReport({
            ...unavailableLiveExtensionReport,
            capabilities: [capability, capability],
        })).toThrow(/duplicate/);
        expect(() => parseLiveExtensionCapabilityReport({
            ...unavailableLiveExtensionReport,
            future: true,
        })).toThrow(/fields/);
        const { reason: _reason, ...withoutReason } = capability;
        expect(() => parseLiveExtensionCapabilityReport({
            ...unavailableLiveExtensionReport,
            capabilities: [withoutReason],
        })).toThrow(/requires a reason/);
    });
});
