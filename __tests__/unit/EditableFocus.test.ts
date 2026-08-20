// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EDITABLE_FOCUS_RELEASE_EVENT,
  NATIVE_APP_FOCUS_EVENT,
  beginEditableFocusRequest,
  blurActiveEditableOutside,
  hasActiveEditableShortcutTarget,
  hasFocusedDomShortcutOwner,
  installEditableFocusLifecycle,
  isEditableFocusRequestCurrent,
  notifyNativeAppFocus,
  releaseEditableFocus,
} from "../../src/services/editableFocus";

describe("editable focus ownership", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("blurs an editor from another unit and invalidates its delayed refocus", () => {
    const firstUnit = document.createElement("div");
    const secondUnit = document.createElement("div");
    const firstInput = document.createElement("input");
    firstInput.type = "number";
    firstUnit.append(firstInput);
    document.body.append(firstUnit, secondUnit);

    firstInput.focus();
    const generation = beginEditableFocusRequest();
    expect(isEditableFocusRequestCurrent(generation)).toBe(true);

    let releaseDetail: { preserveUnitId?: string } | undefined;
    const handleRelease = (event: Event) => {
      releaseDetail = (event as CustomEvent).detail;
    };
    window.addEventListener(EDITABLE_FOCUS_RELEASE_EVENT, handleRelease, { once: true });

    expect(blurActiveEditableOutside(secondUnit, "unit-b")).toBe(true);
    expect(document.activeElement).not.toBe(firstInput);
    expect(isEditableFocusRequestCurrent(generation)).toBe(false);
    expect(releaseDetail).toEqual({ preserveUnitId: "unit-b" });
  });

  it("keeps focus when the active editor belongs to the clicked unit", () => {
    const unit = document.createElement("div");
    const input = document.createElement("input");
    unit.append(input);
    document.body.append(unit);
    input.focus();

    expect(blurActiveEditableOutside(unit)).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("identifies host editors and JavaScript Surface frames as native-shortcut owners", () => {
    const input = document.createElement("input");
    const surfaceFrame = document.createElement("iframe");
    surfaceFrame.dataset.javascriptSurfaceFrame = "true";
    const unrelatedFrame = document.createElement("iframe");
    document.body.append(input, surfaceFrame, unrelatedFrame);

    expect(hasActiveEditableShortcutTarget()).toBe(false);
    input.focus();
    expect(hasActiveEditableShortcutTarget()).toBe(true);
    surfaceFrame.focus();
    expect(hasActiveEditableShortcutTarget()).toBe(true);
    unrelatedFrame.focus();
    expect(hasActiveEditableShortcutTarget()).toBe(false);
  });

  it("reports when the focused DOM owns the same physical shortcut as a native listener", () => {
    const hasFocus = vi.spyOn(document, "hasFocus");

    hasFocus.mockReturnValue(true);
    expect(hasFocusedDomShortcutOwner()).toBe(true);
    hasFocus.mockReturnValue(false);
    expect(hasFocusedDomShortcutOwner()).toBe(false);
  });

  it("invalidates delayed refocus even when the browser already moved focus", () => {
    const input = document.createElement("input");
    const nextUnit = document.createElement("div");
    nextUnit.tabIndex = -1;
    document.body.append(input, nextUnit);

    input.focus();
    const generation = beginEditableFocusRequest();
    nextUnit.focus();

    expect(blurActiveEditableOutside(nextUnit)).toBe(false);
    expect(document.activeElement).toBe(nextUnit);
    expect(isEditableFocusRequestCurrent(generation)).toBe(false);
  });

  it("blurs the active editor and cancels delayed refocus when Hook loses focus", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const generation = beginEditableFocusRequest();
    const dispose = installEditableFocusLifecycle(window);

    window.dispatchEvent(new Event("blur"));

    expect(document.activeElement).not.toBe(input);
    expect(isEditableFocusRequestCurrent(generation)).toBe(false);
    dispose();
  });

  it("releases editable focus for a native window focus loss without restoring it", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const generation = beginEditableFocusRequest();

    let releaseDetail: { preserveUnitId?: string } | undefined;
    window.addEventListener(EDITABLE_FOCUS_RELEASE_EVENT, (event) => {
      releaseDetail = (event as CustomEvent).detail;
    }, { once: true });

    expect(releaseEditableFocus()).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(isEditableFocusRequestCurrent(generation)).toBe(false);
    expect(releaseDetail).toEqual({});

    window.dispatchEvent(new Event("focus"));
    expect(document.activeElement).not.toBe(input);
  });

  it("mirrors the native foreground state and releases iframe focus ownership", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    const focusStates: boolean[] = [];
    window.addEventListener(NATIVE_APP_FOCUS_EVENT, (event) => {
      focusStates.push((event as CustomEvent<{ focused: boolean }>).detail.focused);
    });

    notifyNativeAppFocus(false);
    expect(document.activeElement).not.toBe(input);
    notifyNativeAppFocus(true);
    expect(document.activeElement).not.toBe(input);
    expect(focusStates).toEqual([false, true]);
  });
});
