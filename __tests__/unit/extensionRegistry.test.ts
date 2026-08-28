import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ExtensionRegistry } from "../../src/services/extensionRegistry";
import { parseContributionSnapshot } from "../../src/services/extensionProtocol";

const fixture = (): unknown => JSON.parse(readFileSync(resolve(
    process.cwd(),
    "__tests__/fixtures/capability/extension-snapshot.json",
), "utf8"));

describe("ExtensionRegistry", () => {
    it("parses the canonical snapshot and exposes commands", () => {
        const snapshot = parseContributionSnapshot(fixture());
        expect(snapshot.generation).toBe(1);
        expect(snapshot.contributions.commands[0]?.id).toBe(
            "publisher.example/text-tools.transform",
        );
    });

    it("rejects invalid scopes without replacing the active snapshot", () => {
        const registry = new ExtensionRegistry();
        registry.beginSession("session-1");
        const active = registry.applySnapshot("session-1", fixture());
        const invalid = fixture() as {
            contributions: { commands: Array<{ scopeId: string }> };
        };
        invalid.contributions.commands[0]!.scopeId = "other-scope";

        expect(() => registry.applySnapshot("session-1", invalid)).toThrow(/scope/u);
        expect(registry.snapshot()).toBe(active);
    });

    it("rejects stale sessions and non-increasing generations", () => {
        const registry = new ExtensionRegistry();
        registry.beginSession("session-1");
        registry.applySnapshot("session-1", fixture());

        expect(() => registry.applySnapshot("session-old", fixture())).toThrow(/session/u);
        expect(() => registry.applySnapshot("session-1", fixture())).toThrow(/generation/u);
    });

    it("clears contributions on disconnect and disposes listeners idempotently", () => {
        const registry = new ExtensionRegistry();
        const listener = vi.fn();
        const dispose = registry.subscribe(listener);
        registry.beginSession("session-1");
        registry.applySnapshot("session-1", fixture());
        registry.disconnect("session-1");
        dispose();
        dispose();

        expect(registry.snapshot()).toBeNull();
        expect(registry.contributions("commands")).toEqual([]);
        expect(listener).toHaveBeenLastCalledWith(null);
        expect(listener).toHaveBeenCalledTimes(3);
    });
});
