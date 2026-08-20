let editableFocusGeneration = 0;
let nativeAppFocused = true;

export const EDITABLE_FOCUS_RELEASE_EVENT = "hook:editable-focus-release";
export const NATIVE_APP_FOCUS_EVENT = "hook:native-app-focus";

export interface EditableFocusReleaseDetail {
  preserveUnitId?: string;
}

export interface NativeAppFocusDetail {
  focused: boolean;
}

const activeEditableElement = (): HTMLElement | undefined => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  if (
    !active.isContentEditable
    && active.contentEditable !== "true"
    && active.contentEditable !== "plaintext-only"
    && active.tagName !== "INPUT"
    && active.tagName !== "TEXTAREA"
    && active.tagName !== "SELECT"
  ) {
    return undefined;
  }
  return active;
};

export const hasActiveEditableShortcutTarget = (): boolean => {
  if (activeEditableElement()) return true;
  const active = document.activeElement;
  return typeof HTMLIFrameElement !== "undefined"
    && active instanceof HTMLIFrameElement
    && active.dataset.javascriptSurfaceFrame === "true";
};

/**
 * Native keyboard hooks can observe the same physical key as the focused
 * WebView. In that case the DOM shortcut path is the single owner; accepting
 * the native echo as well can turn one annotation delete into a unit delete.
 */
export const hasFocusedDomShortcutOwner = (): boolean =>
  typeof document !== "undefined" && document.hasFocus();

export const beginEditableFocusRequest = (): number => {
  editableFocusGeneration += 1;
  return editableFocusGeneration;
};

export const isEditableFocusRequestCurrent = (generation: number): boolean =>
  generation === editableFocusGeneration;

export const cancelPendingEditableFocus = (): void => {
  editableFocusGeneration += 1;
};

export const blurActiveEditable = (): boolean => {
  const active = activeEditableElement();
  if (!active) return false;
  active.blur();
  return true;
};

const notifyJavaScriptSurfaces = (preserveUnitId?: string): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EditableFocusReleaseDetail>(
    EDITABLE_FOCUS_RELEASE_EVENT,
    { detail: preserveUnitId ? { preserveUnitId } : {} },
  ));
};

export const releaseEditableFocus = (): boolean => {
  cancelPendingEditableFocus();
  const blurred = blurActiveEditable();
  notifyJavaScriptSurfaces();
  return blurred;
};

export const notifyNativeAppFocus = (focused: boolean): void => {
  nativeAppFocused = focused;
  if (!focused) releaseEditableFocus();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NativeAppFocusDetail>(
    NATIVE_APP_FOCUS_EVENT,
    { detail: { focused } },
  ));
};

export const isNativeAppFocused = (): boolean => nativeAppFocused;

export const blurActiveEditableOutside = (
  container: HTMLElement | undefined,
  preserveUnitId?: string,
): boolean => {
  cancelPendingEditableFocus();
  const active = activeEditableElement();
  const blurred = !!active && !container?.contains(active);
  if (blurred) active.blur();
  notifyJavaScriptSurfaces(preserveUnitId);
  return blurred;
};

export const installEditableFocusLifecycle = (target: Window = window): (() => void) => {
  const handleWindowBlur = () => releaseEditableFocus();

  target.addEventListener("blur", handleWindowBlur);
  return () => target.removeEventListener("blur", handleWindowBlur);
};
