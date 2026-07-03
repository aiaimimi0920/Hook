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
}

interface UseShortcutsOptions {
  handlers: ShortcutHandlers;
  contextProvider: () => string | null;
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

    // On Windows WebView, a bare Alt press can enter the native accelerator
    // path and break the next wheel gesture from reaching the Hook overlay.
    // Hook uses Alt only as an in-canvas modifier, so we suppress the native
    // bare-Alt default at the app boundary.
    const suppressBareAlt = (e: KeyboardEvent) => {
      if (!shouldSuppressBareAlt(e)) return false;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return true;
    };

    // Global keydown listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (suppressBareAlt(e)) return;

      // Skip if editing text
      const target = e.target as HTMLElement;
      const isEditing = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isEditing && !['Escape', 'Tab'].includes(e.key)) return;

      const handled = ShortcutManager.handleKeyDown(e);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (suppressBareAlt(e)) return;
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown, true);
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
