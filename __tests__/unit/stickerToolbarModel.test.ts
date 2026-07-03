import { describe, expect, it } from "vitest";

import { resolveSelectedExistingNodePropertyTool } from "../../src/components/stickerToolbarModel";

describe("stickerToolbarModel existing-node property tool resolution", () => {
    it("only exposes the selected-text property tool for a single selected text annotation in the existing domain", () => {
        expect(resolveSelectedExistingNodePropertyTool("existing", "text", 1)).toBe("selected-text");
        expect(resolveSelectedExistingNodePropertyTool("existing", "text", 2)).toBeNull();
        expect(resolveSelectedExistingNodePropertyTool("create", "text", 1)).toBeNull();
    });

    it("only exposes the selected-serial property tool for a single selected serial annotation in the existing domain", () => {
        expect(resolveSelectedExistingNodePropertyTool("existing", "serial", 1)).toBe("selected-serial");
        expect(resolveSelectedExistingNodePropertyTool("existing", "serial", 0)).toBeNull();
        expect(resolveSelectedExistingNodePropertyTool("sticker", "serial", 1)).toBeNull();
    });

    it("keeps non-text selections out of the existing-node property bar", () => {
        expect(resolveSelectedExistingNodePropertyTool("existing", "rect", 1)).toBeNull();
        expect(resolveSelectedExistingNodePropertyTool("existing", "line", 1)).toBeNull();
        expect(resolveSelectedExistingNodePropertyTool("existing", null, 1)).toBeNull();
    });
});
