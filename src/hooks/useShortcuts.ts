/**
 * useShortcuts - SolidJS hook for keyboard shortcut integration
 *
 * This hook connects the ShortcutManager to SolidJS lifecycle and
 * provides reactive shortcut registration.
 */

import { onMount, onCleanup } from "solid-js";
import { ShortcutManager, DRAG_MODIFIERS } from "../services/shortcuts";

interface ShortcutHandlers {
  // Clipboard
  onCopy?: () => void | Promise<void>;
  onPaste?: () => void | Promise<void>;
  onOpenImage?: () => void | Promise<void>;
  onToggleHistory?: () => void | Promise<void>;
  onSave?: () => void | Promise<void>;
  onUndoEdit?: () => void | Promise<void>;
  onRedoEdit?: () => void | Promise<void>;

  // Unit Operations
  onDelete?: () => void | Promise<void>;
  onCancelSelection?: () => void | Promise<void>;
  onCancelStickerEdit?: () => void | Promise<void>;

  // UI Toggles
  onToggleActions?: () => void | Promise<void>;
  onToggleParams?: () => void | Promise<void>;
  onToggleStickerToolbar?: () => void | Promise<void>;
  onToggleOcr?: () => void | Promise<void>;
  onToggleTranslation?: () => void | Promise<void>;
  onToggleCleanView?: () => void | Promise<void>;
  onTransformSelect?: () => void | Promise<void>;
  onTransformMove?: () => void | Promise<void>;
  onTransformRotate?: () => void | Promise<void>;
  onTransformScale?: () => void | Promise<void>;
  onQuickArt?: (artId: string) => void | Promise<void>;
  onCloseActions?: () => boolean;
}

interface UseShortcutsOptions {
  handlers: ShortcutHandlers;
  contextProvider: () => string | null;
}

export function isGlobalShortcutEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  for (let current: Element | null = target; current; current = current.parentElement) {
    if (
      current instanceof HTMLElement
      && (current.isContentEditable
        || current.contentEditable === "true"
        || current.contentEditable === "plaintext-only")
    ) {
      return true;
    }
  }
  return target.closest(
    "input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']",
  ) !== null;
}

export function shouldIgnoreGlobalShortcut(target: EventTarget | null, _key: string): boolean {
  return isGlobalShortcutEditingTarget(target);
}

export function isActionsMenuDismissShortcut(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey"> & { code?: string },
): boolean {
  if (event.key === "Escape") return true;
  return ShortcutManager.matchesShortcutEvent("toggle-actions", {
    key: event.key,
    code: event.code || "",
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  });
}

/**
 * Hook to set up keyboard shortcut handling
 */
export function useShortcuts(options: UseShortcutsOptions) {
  onMount(() => {
    // Set context provider
    ShortcutManager.setContextProvider(options.contextProvider);

    // Register handlers
    const { handlers } = options;
    ShortcutManager.setQuickBindingHandler(handlers.onQuickArt || null);

    if (handlers.onCopy) ShortcutManager.register('copy', handlers.onCopy);
    if (handlers.onPaste) ShortcutManager.register('paste', handlers.onPaste);
    if (handlers.onOpenImage) ShortcutManager.register('open-image', handlers.onOpenImage);
    if (handlers.onToggleHistory) ShortcutManager.register('toggle-history', handlers.onToggleHistory);
    if (handlers.onSave) ShortcutManager.register('save', handlers.onSave);
    if (handlers.onUndoEdit) ShortcutManager.register('undo-edit', handlers.onUndoEdit);
    if (handlers.onRedoEdit) ShortcutManager.register('redo-edit', handlers.onRedoEdit);

    if (handlers.onDelete) {
      ShortcutManager.register('delete', handlers.onDelete);
      ShortcutManager.register('delete-backspace', handlers.onDelete);
      ShortcutManager.register('delete-escape', handlers.onDelete);
    }
    if (handlers.onCancelSelection) ShortcutManager.register('cancel-selection', handlers.onCancelSelection);
    if (handlers.onCancelStickerEdit) ShortcutManager.register('cancel-sticker-edit', handlers.onCancelStickerEdit);

    if (handlers.onToggleActions) ShortcutManager.register('toggle-actions', handlers.onToggleActions);
    if (handlers.onToggleParams) ShortcutManager.register('toggle-params', handlers.onToggleParams);
    if (handlers.onToggleStickerToolbar) ShortcutManager.register('toggle-sticker-toolbar', handlers.onToggleStickerToolbar);
    if (handlers.onToggleOcr) ShortcutManager.register('toggle-ocr', handlers.onToggleOcr);
    if (handlers.onToggleTranslation) ShortcutManager.register('toggle-translation', handlers.onToggleTranslation);
    if (handlers.onToggleCleanView) ShortcutManager.register('toggle-clean-view', handlers.onToggleCleanView);
    if (handlers.onTransformSelect) ShortcutManager.register('transform-select', handlers.onTransformSelect);
    if (handlers.onTransformMove) ShortcutManager.register('transform-move', handlers.onTransformMove);
    if (handlers.onTransformRotate) ShortcutManager.register('transform-rotate', handlers.onTransformRotate);
    if (handlers.onTransformScale) ShortcutManager.register('transform-scale', handlers.onTransformScale);
    if (handlers.onTransformSelect) ShortcutManager.register('transform-select-editing', handlers.onTransformSelect);
    if (handlers.onTransformMove) ShortcutManager.register('transform-move-editing', handlers.onTransformMove);
    if (handlers.onTransformRotate) ShortcutManager.register('transform-rotate-editing', handlers.onTransformRotate);
    if (handlers.onTransformScale) ShortcutManager.register('transform-scale-editing', handlers.onTransformScale);

    const shouldSuppressBareAlt = (e: KeyboardEvent) =>
      e.key === 'Alt' && !e.ctrlKey && !e.metaKey;

    // Prevent only the WebView accelerator default. Do not stop propagation:
    // Alt is also a modifier used by other input consumers, and Hook must not
    // make the key disappear from the remaining event chain.
    const suppressBareAlt = (e: KeyboardEvent) => {
      if (!shouldSuppressBareAlt(e)) return false;
      e.preventDefault();
      return true;
    };

    const executeShortcut = (e: KeyboardEvent) => {
      const handled = ShortcutManager.handleKeyDown(e);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Global capture listener. Editable targets are deferred so their target
    // handler can consume Escape before the selected-unit fallback runs.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (suppressBareAlt(e)) return;

      // A blocking dialog owns its keyboard context. In particular, do not
      // close an actions menu behind the dialog from this capture listener.
      if (options.contextProvider() === "modal") return;

      if (
        handlers.onCloseActions
        && isActionsMenuDismissShortcut(e)
        && handlers.onCloseActions()
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (shouldIgnoreGlobalShortcut(e.target, e.key)) return;

      executeShortcut(e);
    };

    const handleDeferredEditableEscape = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape"
        || !isGlobalShortcutEditingTarget(e.target)
        || e.defaultPrevented
      ) return;
      executeShortcut(e);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (suppressBareAlt(e)) return;
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keydown', handleDeferredEditableEscape);
    window.addEventListener('keyup', handleKeyUp, true);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleDeferredEditableEscape);
      window.removeEventListener('keyup', handleKeyUp, true);

      // Unregister all handlers
      ShortcutManager.unregister('copy');
      ShortcutManager.unregister('paste');
      ShortcutManager.unregister('open-image');
      ShortcutManager.unregister('toggle-history');
      ShortcutManager.unregister('save');
      ShortcutManager.unregister('undo-edit');
      ShortcutManager.unregister('redo-edit');
      ShortcutManager.unregister('delete');
      ShortcutManager.unregister('delete-backspace');
      ShortcutManager.unregister('delete-escape');
      ShortcutManager.unregister('cancel-selection');
      ShortcutManager.unregister('cancel-sticker-edit');
      ShortcutManager.unregister('toggle-actions');
      ShortcutManager.unregister('toggle-params');
      ShortcutManager.unregister('toggle-sticker-toolbar');
      ShortcutManager.unregister('toggle-ocr');
      ShortcutManager.unregister('toggle-translation');
      ShortcutManager.unregister('toggle-clean-view');
      ShortcutManager.unregister('transform-select');
      ShortcutManager.unregister('transform-move');
      ShortcutManager.unregister('transform-rotate');
      ShortcutManager.unregister('transform-scale');
      ShortcutManager.unregister('transform-select-editing');
      ShortcutManager.unregister('transform-move-editing');
      ShortcutManager.unregister('transform-rotate-editing');
      ShortcutManager.unregister('transform-scale-editing');
      ShortcutManager.setQuickBindingHandler(null);
    });
  });
}

/**
 * Check drag modifiers for mouse events
 */
export function checkDragModifier(e: MouseEvent, type: keyof typeof DRAG_MODIFIERS): boolean {
  return ShortcutManager.isDragModifierActive(e, type);
}

/**
 * Re-export for convenience
 */
export { ShortcutManager, DRAG_MODIFIERS };
