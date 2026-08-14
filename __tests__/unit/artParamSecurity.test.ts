import { describe, expect, it } from "vitest";

import { stripNonPersistableArtParams } from "../../src/services/artParamSecurity";
import type { ArtCapability } from "../../src/services/protocol";

const capability: ArtCapability = {
    id: "publisher.example/image-search",
    label: "Image Search",
    description: "",
    supported_transports: ["shared_memory"],
    params: [
        { id: "query", label: "Query", widget: "text", default: "" },
        { id: "brave_api_key", label: "Brave API Key", widget: "text", default: undefined, secret: true },
    ],
};

describe("Art parameter security", () => {
    it("removes capability-declared secrets from persisted and synchronized params", () => {
        expect(stripNonPersistableArtParams(
            { type: "art", artId: capability.id },
            [capability],
            { query: "red panda", brave_api_key: "must-not-leave-hook" },
        )).toEqual({ query: "red panda" });
    });

    it("removes Hook execution controls while preserving Art-owned selection params", () => {
        expect(stripNonPersistableArtParams(
            { type: "art", artId: capability.id },
            [capability],
            {
                query: "red panda",
                result_index: 1,
                __exec_manualTrigger: 123,
                __ui_resize: { w: 320, h: 240 },
                force_update: 456,
            },
        )).toEqual({ query: "red panda", result_index: 1 });
    });

    it("does not reinterpret ordinary sticker params", () => {
        const params = { label: "visible" };
        expect(stripNonPersistableArtParams(
            { type: "sticker", artId: undefined },
            [capability],
            params,
        )).toBe(params);
    });
});
