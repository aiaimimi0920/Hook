import { describe, expect, it } from "vitest";

import { stripSecretArtParams } from "../../src/services/artParamSecurity";
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
        expect(stripSecretArtParams(
            { type: "art", artId: capability.id },
            [capability],
            { query: "red panda", brave_api_key: "must-not-leave-hook" },
        )).toEqual({ query: "red panda" });
    });

    it("does not reinterpret ordinary sticker params", () => {
        const params = { label: "visible" };
        expect(stripSecretArtParams(
            { type: "sticker", artId: undefined },
            [capability],
            params,
        )).toBe(params);
    });
});
