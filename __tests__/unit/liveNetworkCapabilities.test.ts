import { describe, expect, it } from "vitest";

import {
    parseLiveNetworkCapabilityReport,
    unavailableLiveNetworkReport,
} from "../../src/services/liveNetworkCapabilities";

describe("hook.live.network.v1", () => {
    it("keeps LAN independent while cloud and NAT providers are unavailable", () => {
        const report = parseLiveNetworkCapabilityReport(unavailableLiveNetworkReport);
        expect(report.lanIndependent).toBe(true);
        expect(report.transports.map((transport) => transport.id)).toEqual([
            "websocket_binary",
            "cloud_relay",
            "webrtc_turn",
        ]);
        expect(report.transports.every((transport) =>
            transport.availability === "unavailable" && Boolean(transport.reason),
        )).toBe(true);
    });

    it("rejects weakened non-loopback security and cloud retention", () => {
        expect(() => parseLiveNetworkCapabilityReport({
            ...unavailableLiveNetworkReport,
            nonLoopbackTlsRequired: false,
        })).toThrow(/cannot be weakened/);
        expect(() => parseLiveNetworkCapabilityReport({
            ...unavailableLiveNetworkReport,
            privacy: { ...unavailableLiveNetworkReport.privacy, cloudFramePersistence: true },
        })).toThrow(/privacy posture/);
    });

    it("rejects credential-bearing origins and inconsistent availability reasons", () => {
        expect(() => parseLiveNetworkCapabilityReport({
            ...unavailableLiveNetworkReport,
            configuredScope: "private_https",
            baseUrlOrigin: "https://user:secret@loom.example.test",
        })).toThrow(/credentials/);
        expect(() => parseLiveNetworkCapabilityReport({
            ...unavailableLiveNetworkReport,
            transports: unavailableLiveNetworkReport.transports.map((transport) =>
                transport.id === "cloud_relay"
                    ? { ...transport, availability: "available" as const }
                    : transport),
        })).toThrow(/denial reason/);
    });

    it("accepts an origin-only private HTTPS websocket report", () => {
        const report = parseLiveNetworkCapabilityReport({
            ...unavailableLiveNetworkReport,
            configuredScope: "private_https",
            baseUrlOrigin: "https://loom.example.test:8765",
            remoteSurfaceEnabled: true,
            transports: unavailableLiveNetworkReport.transports.map((transport) =>
                transport.id === "websocket_binary"
                    ? { id: transport.id, availability: "available" as const }
                    : transport),
        });
        expect(report.configuredScope).toBe("private_https");
    });

    it("requires origin protocol and host to match the configured scope", () => {
        const report = (configuredScope: string, baseUrlOrigin: string) => ({
            ...unavailableLiveNetworkReport,
            configuredScope,
            baseUrlOrigin,
        });
        expect(() => parseLiveNetworkCapabilityReport(
            report("loopback_http", "https://loom.example.test"),
        )).toThrow(/configured scope/);
        expect(() => parseLiveNetworkCapabilityReport(
            report("loopback_https", "https://127.0.0.1.evil.example"),
        )).toThrow(/configured scope/);
        expect(() => parseLiveNetworkCapabilityReport(
            report("private_https", "https://[::1]:8765"),
        )).toThrow(/configured scope/);
        expect(parseLiveNetworkCapabilityReport(
            report("loopback_http", "http://127.1:8765"),
        ).configuredScope).toBe("loopback_http");
    });
});
