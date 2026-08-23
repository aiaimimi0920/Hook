// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
    acceptsSurfaceRelayedKeydown,
    isRelayableSurfaceHostKeydown,
    isSurfaceRelayedKeydown,
    markSurfaceRelayedKeydown,
    type SurfaceHostKeydownShape,
} from "../../src/services/surfaceHostKeydown";

const keydown = (overrides: Partial<SurfaceHostKeydownShape>): SurfaceHostKeydownShape => ({
    key: "a",
    code: "KeyA",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
});

describe("surface host keydown relay policy", () => {
    it("relays only the keys the host consumes from a Surface", () => {
        expect(isRelayableSurfaceHostKeydown(keydown({ key: "Escape", code: "Escape" }))).toBe(true);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "e", code: "KeyE", ctrlKey: true }),
        )).toBe(true);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "Control", code: "ControlLeft", ctrlKey: true }),
        )).toBe(true);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "Shift", code: "ShiftLeft", shiftKey: true }),
        )).toBe(true);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "Alt", code: "AltLeft", altKey: true }),
        )).toBe(true);
        // A second modifier press while the first is held must still reach the host,
        // otherwise modifier tracking desynchronizes mid-drag.
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "Shift", code: "ShiftLeft", shiftKey: true, ctrlKey: true }),
        )).toBe(true);
    });

    it("drops every key a sandbox has no business synthesizing", () => {
        expect(isRelayableSurfaceHostKeydown(keydown({ key: "Delete", code: "Delete" }))).toBe(false);
        expect(isRelayableSurfaceHostKeydown(keydown({ key: "Tab", code: "Tab" }))).toBe(false);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "s", code: "KeyS", ctrlKey: true }),
        )).toBe(false);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "q", code: "KeyQ", ctrlKey: true }),
        )).toBe(false);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "!", code: "Digit1", shiftKey: true }),
        )).toBe(false);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "Enter", code: "Enter" }),
        )).toBe(false);
        // The reserved edit-mode shortcut is Ctrl+E exactly, not any E.
        expect(isRelayableSurfaceHostKeydown(keydown({ key: "e", code: "KeyE" }))).toBe(false);
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "E", code: "KeyE", ctrlKey: true, shiftKey: true }),
        )).toBe(false);
        // Escape only counts as the plain dismissal key.
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "Escape", code: "Escape", ctrlKey: true }),
        )).toBe(false);
        // A lying modifier flag must not smuggle another key through.
        expect(isRelayableSurfaceHostKeydown(
            keydown({ key: "F4", code: "F4", altKey: true }),
        )).toBe(false);
    });

    it("tags relayed events so host listeners can opt in deliberately", () => {
        const relayed = markSurfaceRelayedKeydown(new KeyboardEvent("keydown", { key: "Escape" }));
        const userEvent = new KeyboardEvent("keydown", { key: "Escape" });

        expect(isSurfaceRelayedKeydown(relayed)).toBe(true);
        expect(isSurfaceRelayedKeydown(userEvent)).toBe(false);
        expect(acceptsSurfaceRelayedKeydown(relayed)).toBe(false);
        expect(acceptsSurfaceRelayedKeydown(relayed, { surfaceRelayed: true })).toBe(true);
        // Hook replays the native overlay keyboard hook as untrusted keydowns, so an
        // untagged synthetic event must stay indistinguishable from a real keystroke.
        expect(userEvent.isTrusted).toBe(false);
        expect(acceptsSurfaceRelayedKeydown(userEvent)).toBe(true);
        expect(acceptsSurfaceRelayedKeydown(userEvent, { surfaceRelayed: true })).toBe(true);
    });

    it("keeps the tag unforgeable from the sandbox side of the port", () => {
        const relayed = markSurfaceRelayedKeydown(new KeyboardEvent("keydown", { key: "Escape" }));
        const record = relayed as unknown as Record<string, unknown>;

        expect(Object.keys(relayed)).not.toContain("hookSurfaceRelayedKeydown");
        expect(() => {
            record.hookSurfaceRelayedKeydown = false;
        }).toThrow();
        expect(isSurfaceRelayedKeydown(relayed)).toBe(true);
    });
});
