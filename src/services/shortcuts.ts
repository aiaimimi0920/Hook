/**
 * Shortcut Manager - Centralized Keyboard Binding Management
 *
 * This module provides a clean API for registering, managing, and handling
 * keyboard shortcuts throughout the application. It prevents conflicts
 * and makes it easy to customize bindings.
 */

export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta';

export interface ShortcutCandidate {
  key: string;
  modifiers: ModifierKey[];
}

export interface ShortcutDef {
  id: string;             // Unique identifier (e.g., "copy", "paste")
  key: string;            // Key code (e.g., "c", "Delete", "Tab")
  modifiers: ModifierKey[]; // Required modifiers
  description: string;    // Human-readable description
  enabled: boolean;       // Whether shortcut is active
  context?: string;       // Optional context (e.g., "unit-selected")
  candidates?: ShortcutCandidate[];
}

export interface ShortcutBinding extends ShortcutDef {
  action: () => void | Promise<void>;
}

// Default shortcut definitions
export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Clipboard Operations
  { id: 'copy', key: 'c', modifiers: ['ctrl'], description: 'Copy selected unit', enabled: true, context: 'unit-selected' },
  { id: 'paste', key: 'v', modifiers: ['ctrl'], description: 'Paste unit', enabled: true },
  { id: 'open-image', key: 'o', modifiers: ['ctrl'], description: 'Open image file to edit', enabled: true },
  { id: 'toggle-history', key: 'h', modifiers: ['ctrl'], description: 'Toggle color/screenshot history panel', enabled: true },
  { id: 'save', key: 's', modifiers: ['ctrl'], description: 'Save image', enabled: true, context: 'unit-selected' },
  { id: 'undo-edit', key: 'z', modifiers: ['ctrl'], description: 'Undo sticker edit', enabled: true, context: 'unit-selected' },
  { id: 'redo-edit', key: 'y', modifiers: ['ctrl'], description: 'Redo sticker edit', enabled: true, context: 'unit-selected' },

  // Unit Operations
  { id: 'delete', key: 'Delete', modifiers: [], description: 'Delete selected unit', enabled: true, context: 'unit-selected' },
  { id: 'delete-backspace', key: 'Backspace', modifiers: [], description: 'Delete selected unit', enabled: true, context: 'unit-selected' },
  { id: 'delete-escape', key: 'Escape', modifiers: [], description: 'Delete/Deselect unit', enabled: true, context: 'unit-selected' },
  { id: 'cancel-selection', key: 'Escape', modifiers: [], description: 'Cancel screenshot selection', enabled: true, context: 'capture-selecting' },
  { id: 'cancel-sticker-edit', key: 'Escape', modifiers: [], description: 'Cancel sticker edit draft', enabled: true, context: 'sticker-editing' },

  // UI Toggles
  { id: 'toggle-actions', key: '!', modifiers: ['shift'], description: 'Toggle Actions Menu', enabled: true, context: 'unit-selected' },
  { id: 'toggle-params', key: 'Tab', modifiers: [], description: 'Toggle Parameter Panel', enabled: true, context: 'unit-selected' },
  { id: 'toggle-sticker-toolbar', key: 'e', modifiers: ['ctrl'], description: 'Toggle sticker toolbar', enabled: true },
  { id: 'toggle-translation', key: '3', modifiers: ['alt'], description: 'Toggle translation', enabled: true, context: 'unit-selected' },
  { id: 'toggle-clean-view', key: '4', modifiers: ['ctrl'], description: 'Toggle Clean View Mode', enabled: true },
  { id: 'transform-select', key: 'q', modifiers: [], description: 'Switch sticker transform mode to select', enabled: true, context: 'unit-selected' },
  { id: 'transform-move', key: 'w', modifiers: [], description: 'Switch sticker transform mode to move', enabled: true, context: 'unit-selected' },
  { id: 'transform-rotate', key: 'e', modifiers: [], description: 'Switch sticker transform mode to rotate', enabled: true, context: 'unit-selected' },
  { id: 'transform-scale', key: 'r', modifiers: [], description: 'Switch sticker transform mode to scale', enabled: true, context: 'unit-selected' },
  { id: 'transform-select-editing', key: 'q', modifiers: [], description: 'Switch sticker transform mode to select while editing', enabled: true, context: 'sticker-editing' },
  { id: 'transform-move-editing', key: 'w', modifiers: [], description: 'Switch sticker transform mode to move while editing', enabled: true, context: 'sticker-editing' },
  { id: 'transform-rotate-editing', key: 'e', modifiers: [], description: 'Switch sticker transform mode to rotate while editing', enabled: true, context: 'sticker-editing' },
  { id: 'transform-scale-editing', key: 'r', modifiers: [], description: 'Switch sticker transform mode to scale while editing', enabled: true, context: 'sticker-editing' },
];

// Drag modifier shortcuts (checked during mouse events, not keydown)
export const DRAG_MODIFIERS: Record<'alignment' | 'dragOut' | 'cascade', ModifierKey> = {
  alignment: 'alt' as ModifierKey,     // Node snapping/alignment
  dragOut: 'shift' as ModifierKey,     // File drag-out to folder
  cascade: 'ctrl' as ModifierKey,      // Stack/cascade placement
};

export interface LoomShortcutConfig {
  id?: string;
  keys?: string;
  enabled?: boolean;
}

export interface LoomQuickBindingConfig {
  id?: string;
  art?: string;
  key?: string;
}

export interface LoomHookSettings {
  shortcuts?: Record<string, LoomShortcutConfig>;
  quick_bindings?: LoomQuickBindingConfig[];
}

const LOOM_SHORTCUT_ACTIONS: Record<string, string[]> = {
  open_image: ['open-image'],
  save_image: ['save'],
  toggle_clean_view: ['toggle-clean-view'],
  cancel: ['cancel-selection', 'cancel-sticker-edit'],
  toggle_actions: ['toggle-actions'],
  toggle_params: ['toggle-params'],
  copy_unit: ['copy'],
  paste_unit: ['paste'],
  delete_unit: ['delete', 'delete-backspace', 'delete-escape'],
  toggle_sticker_toolbar: ['toggle-sticker-toolbar'],
  undo_edit: ['undo-edit'],
  redo_edit: ['redo-edit'],
  transform_select: ['transform-select', 'transform-select-editing'],
  transform_move: ['transform-move', 'transform-move-editing'],
  transform_rotate: ['transform-rotate', 'transform-rotate-editing'],
  transform_scale: ['transform-scale', 'transform-scale-editing'],
};

const MODIFIER_ALIASES: Record<string, ModifierKey> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
};

const normalizeKey = (key: string): string => {
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'esc') return 'Escape';
  if (lower === 'space' || lower === 'spacebar') return ' ';
  if (lower === 'del') return 'Delete';
  if (lower === 'backspace') return 'Backspace';
  if (lower === 'tab') return 'Tab';
  if (trimmed.length === 1) return trimmed.toLowerCase();
  return trimmed;
};

export const parseShortcutAlternatives = (value: string): ShortcutCandidate[] => value
  .split(/\s*\/\s*/)
  .map((candidate) => candidate.trim())
  .filter(Boolean)
  .map((candidate) => {
    const parts = candidate.split('+').map((part) => part.trim()).filter(Boolean);
    const modifiers: ModifierKey[] = [];
    let key = '';
    for (const part of parts) {
      const modifier = MODIFIER_ALIASES[part.toLowerCase()];
      if (modifier) {
        if (!modifiers.includes(modifier)) modifiers.push(modifier);
      } else {
        key = normalizeKey(part);
      }
    }
    return key ? { key, modifiers } : null;
  })
  .filter((candidate): candidate is ShortcutCandidate => candidate !== null);

const firstGestureModifier = (value: string | undefined): ModifierKey | null => {
  if (!value) return null;
  const candidate = value.split(/\s*\/\s*/)[0]?.trim() || '';
  for (const part of candidate.split('+')) {
    const modifier = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (modifier) return modifier;
  }
  return null;
};

class ShortcutManagerClass {
  private bindings: Map<string, ShortcutBinding> = new Map();
  private definitions: Map<string, ShortcutDef> = new Map();
  private contextProvider: (() => string | null) | null = null;
  private quickBindings: Array<{ id: string; art: string; candidates: ShortcutCandidate[] }> = [];
  private quickBindingHandler: ((artId: string) => void | Promise<void>) | null = null;
  private gestureBindings: Map<string, ShortcutCandidate[]> = new Map([
    ['sticker_resize', parseShortcutAlternatives('Ctrl+滚轮')],
    ['sticker_opacity', parseShortcutAlternatives('Alt+滚轮')],
    ['drag_alignment', parseShortcutAlternatives('Alt+拖动')],
    ['drag_out', parseShortcutAlternatives('Shift+拖动')],
    ['drag_cascade', parseShortcutAlternatives('Ctrl+拖动')],
    ['control_multi_select', parseShortcutAlternatives('Shift+点击')],
    ['control_quick_move', parseShortcutAlternatives('Alt+拖动')],
    ['control_quick_rotate', parseShortcutAlternatives('Ctrl+拖动')],
    ['control_scale', parseShortcutAlternatives('Ctrl+Alt+滚轮')],
    ['control_scale_own_center', parseShortcutAlternatives('Ctrl+Alt+Shift+滚轮')],
  ]);

  constructor() {
    this.resetToDefaults();
  }

  resetToDefaults(): void {
    this.bindings.clear();
    this.definitions.clear();
    DEFAULT_SHORTCUTS.forEach(def => {
      this.definitions.set(def.id, {
        ...def,
        modifiers: [...def.modifiers],
        candidates: [{ key: def.key, modifiers: [...def.modifiers] }],
      });
    });
    this.quickBindings = [];
    this.quickBindingHandler = null;
    DRAG_MODIFIERS.alignment = 'alt';
    DRAG_MODIFIERS.dragOut = 'shift';
    DRAG_MODIFIERS.cascade = 'ctrl';
    this.gestureBindings = new Map([
      ['sticker_resize', parseShortcutAlternatives('Ctrl+滚轮')],
      ['sticker_opacity', parseShortcutAlternatives('Alt+滚轮')],
      ['drag_alignment', parseShortcutAlternatives('Alt+拖动')],
      ['drag_out', parseShortcutAlternatives('Shift+拖动')],
      ['drag_cascade', parseShortcutAlternatives('Ctrl+拖动')],
      ['control_multi_select', parseShortcutAlternatives('Shift+点击')],
      ['control_quick_move', parseShortcutAlternatives('Alt+拖动')],
      ['control_quick_rotate', parseShortcutAlternatives('Ctrl+拖动')],
      ['control_scale', parseShortcutAlternatives('Ctrl+Alt+滚轮')],
      ['control_scale_own_center', parseShortcutAlternatives('Ctrl+Alt+Shift+滚轮')],
    ]);
  }

  /**
   * Set the context provider function.
   * This function returns the current context (e.g., "unit-selected" or null)
   */
  setContextProvider(provider: () => string | null): void {
    this.contextProvider = provider;
  }

  setQuickBindingHandler(handler: ((artId: string) => void | Promise<void>) | null): void {
    this.quickBindingHandler = handler;
  }

  private restoreRuntimeDefaults(): void {
    for (const defaultDef of DEFAULT_SHORTCUTS) {
      const def = this.definitions.get(defaultDef.id);
      if (!def) continue;
      def.key = defaultDef.key;
      def.modifiers = [...defaultDef.modifiers];
      def.enabled = defaultDef.enabled;
      def.candidates = [{ key: defaultDef.key, modifiers: [...defaultDef.modifiers] }];
      const binding = this.bindings.get(defaultDef.id);
      if (binding) {
        binding.key = def.key;
        binding.modifiers = [...def.modifiers];
        binding.enabled = def.enabled;
        binding.candidates = def.candidates.map((candidate) => ({
          key: candidate.key,
          modifiers: [...candidate.modifiers],
        }));
      }
    }
    DRAG_MODIFIERS.alignment = 'alt';
    DRAG_MODIFIERS.dragOut = 'shift';
    DRAG_MODIFIERS.cascade = 'ctrl';
    this.gestureBindings = new Map([
      ['sticker_resize', parseShortcutAlternatives('Ctrl+滚轮')],
      ['sticker_opacity', parseShortcutAlternatives('Alt+滚轮')],
      ['drag_alignment', parseShortcutAlternatives('Alt+拖动')],
      ['drag_out', parseShortcutAlternatives('Shift+拖动')],
      ['drag_cascade', parseShortcutAlternatives('Ctrl+拖动')],
      ['control_multi_select', parseShortcutAlternatives('Shift+点击')],
      ['control_quick_move', parseShortcutAlternatives('Alt+拖动')],
      ['control_quick_rotate', parseShortcutAlternatives('Ctrl+拖动')],
      ['control_scale', parseShortcutAlternatives('Ctrl+Alt+滚轮')],
      ['control_scale_own_center', parseShortcutAlternatives('Ctrl+Alt+Shift+滚轮')],
    ]);
  }

  applyLoomSettings(settings: unknown): void {
    if (!settings || typeof settings !== 'object') return;
    this.restoreRuntimeDefaults();
    const snapshot = settings as LoomHookSettings;
    const shortcuts = snapshot.shortcuts || {};
    for (const [sourceId, actionIds] of Object.entries(LOOM_SHORTCUT_ACTIONS)) {
      const config = shortcuts[sourceId];
      if (!config) continue;
      const candidates = parseShortcutAlternatives(config.keys || '');
      for (const actionId of actionIds) {
        const def = this.definitions.get(actionId);
        if (!def) continue;
        def.enabled = config.enabled !== false && candidates.length > 0;
        if (candidates.length > 0) {
          def.candidates = candidates.map((candidate) => ({
            key: candidate.key,
            modifiers: [...candidate.modifiers],
          }));
          def.key = candidates[0].key;
          def.modifiers = [...candidates[0].modifiers];
        }
        const binding = this.bindings.get(actionId);
        if (binding) {
          binding.enabled = def.enabled;
          binding.candidates = def.candidates?.map((candidate) => ({
            key: candidate.key,
            modifiers: [...candidate.modifiers],
          }));
          binding.key = def.key;
          binding.modifiers = [...def.modifiers];
        }
      }
    }

    const gestureMappings: Array<[string, keyof typeof DRAG_MODIFIERS]> = [
      ['drag_alignment', 'alignment'],
      ['drag_out', 'dragOut'],
      ['drag_cascade', 'cascade'],
    ];
    for (const [sourceId, target] of gestureMappings) {
      const modifier = firstGestureModifier(shortcuts[sourceId]?.keys);
      if (modifier) DRAG_MODIFIERS[target] = modifier;
    }
    for (const sourceId of [
      'sticker_resize',
      'sticker_opacity',
      'drag_alignment',
      'drag_out',
      'drag_cascade',
      'control_multi_select',
      'control_quick_move',
      'control_quick_rotate',
      'control_scale',
      'control_scale_own_center',
    ]) {
      const config = shortcuts[sourceId];
      if (!config) continue;
      this.gestureBindings.set(
        sourceId,
        config.enabled === false ? [] : parseShortcutAlternatives(config.keys || ''),
      );
    }

    const quickBindings = snapshot.quick_bindings || [];
    this.quickBindings = quickBindings.flatMap((binding) => {
      const art = binding.art?.trim();
      const candidates = parseShortcutAlternatives(binding.key || '');
      if (!art || candidates.length === 0) return [];
      return [{ id: binding.id || art, art, candidates }];
    });
  }

  /**
   * Register an action for a shortcut ID
   */
  register(id: string, action: () => void | Promise<void>): boolean {
    const def = this.definitions.get(id);
    if (!def) {
      console.warn(`[ShortcutManager] Unknown shortcut ID: ${id}`);
      return false;
    }

    this.bindings.set(id, {
      ...def,
      modifiers: [...def.modifiers],
      candidates: def.candidates?.map((candidate) => ({
        key: candidate.key,
        modifiers: [...candidate.modifiers],
      })),
      action,
    });
    return true;
  }

  /**
   * Unregister a shortcut action
   */
  unregister(id: string): void {
    this.bindings.delete(id);
  }

  /**
   * Update a shortcut's key binding
   */
  updateBinding(id: string, key: string, modifiers: ModifierKey[]): boolean {
    const def = this.definitions.get(id);
    if (!def) return false;

    // Check for conflicts
    const conflict = this.findConflict(key, modifiers, id);
    if (conflict) {
      console.warn(`[ShortcutManager] Conflict with "${conflict.id}": ${conflict.description}`);
      return false;
    }

    def.key = key;
    def.modifiers = modifiers;
    def.candidates = [{ key, modifiers: [...modifiers] }];

    // Update binding if exists
    const binding = this.bindings.get(id);
    if (binding) {
      binding.key = key;
      binding.modifiers = modifiers;
      binding.candidates = [{ key, modifiers: [...modifiers] }];
    }

    return true;
  }

  /**
   * Enable or disable a shortcut
   */
  setEnabled(id: string, enabled: boolean): void {
    const def = this.definitions.get(id);
    if (def) def.enabled = enabled;

    const binding = this.bindings.get(id);
    if (binding) binding.enabled = enabled;
  }

  /**
   * Find conflicting shortcut
   */
  private findConflict(key: string, modifiers: ModifierKey[], excludeId?: string): ShortcutDef | null {
    for (const [id, def] of this.definitions) {
      if (id === excludeId) continue;
      if (
        def.context === this.definitions.get(excludeId || '')?.context
        && (def.candidates || [{ key: def.key, modifiers: def.modifiers }])
          .some((candidate) => candidate.key === key && this.modifiersMatch(candidate.modifiers, modifiers))
      ) {
        return def;
      }
    }
    return null;
  }

  private modifiersMatch(a: ModifierKey[], b: ModifierKey[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }

  /**
   * Check if modifiers in event match requirements
   */
  private eventMatchesModifiers(e: KeyboardEvent, modifiers: ModifierKey[], triggerKey: string): boolean {
    const hasCtrl = modifiers.includes('ctrl');
    const hasAlt = modifiers.includes('alt');
    const hasShift = modifiers.includes('shift');
    const hasMeta = modifiers.includes('meta');

    // If the trigger key IS the modifier (e.g. key="Shift"), the event.shiftKey will be true.
    // We strictly enforce modifiers from the definition, but exempt the flag corresponding to the trigger key itself.

    if (triggerKey === 'Control') {
         if (e.altKey !== hasAlt) return false;
         if (e.shiftKey !== hasShift) return false;
         if (e.metaKey !== hasMeta) return false;
         // e.ctrlKey is expected to be true, but binding.modifiers might be empty. Ignore e.ctrlKey check.
         return true;
    }

    if (triggerKey === 'Shift') {
         if (e.ctrlKey !== hasCtrl) return false;
         if (e.altKey !== hasAlt) return false;
         if (e.metaKey !== hasMeta) return false;
         return true;
    }

    if (triggerKey === 'Alt') {
         if (e.ctrlKey !== hasCtrl) return false;
         if (e.shiftKey !== hasShift) return false;
         if (e.metaKey !== hasMeta) return false;
         return true;
    }

    return (
      e.ctrlKey === hasCtrl &&
      e.altKey === hasAlt &&
      e.shiftKey === hasShift &&
      e.metaKey === hasMeta
    );
  }

  private eventMatchesKey(e: KeyboardEvent, key: string): boolean {
    const eventKey = e.key || '';
    if (eventKey === key || eventKey.toLowerCase() === key.toLowerCase()) return true;
    if (key === '!') return e.code === 'Digit1' && e.shiftKey;
    if (key.length !== 1) return false;
    if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
    if (/^[a-z]$/i.test(key)) return e.code === `Key${key.toUpperCase()}`;
    return false;
  }

  matchesShortcutEvent(
    id: string,
    e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  ): boolean {
    const def = this.definitions.get(id);
    if (!def?.enabled) return false;
    const event = e as KeyboardEvent;
    return (def.candidates || [{ key: def.key, modifiers: def.modifiers }]).some((candidate) => (
      this.eventMatchesKey(event, candidate.key)
      && this.eventMatchesModifiers(event, candidate.modifiers, candidate.key)
    ));
  }

  /**
   * Handle keydown event - call this from global listener
   * Returns true if a shortcut was handled
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    const currentContext = this.contextProvider?.() || null;

    for (const [_, binding] of this.bindings) {
      if (!binding.enabled) continue;

      // Check context requirement
      if (binding.context && binding.context !== currentContext) continue;

      const candidate = (binding.candidates || [{ key: binding.key, modifiers: binding.modifiers }])
        .find((entry) => (
          this.eventMatchesKey(e, entry.key)
          && this.eventMatchesModifiers(e, entry.modifiers, entry.key)
        ));
      if (!candidate) continue;

      // Skip repeated key presses for certain shortcuts
      if (e.repeat && (candidate.key === 'Control' || candidate.key === 'Shift')) continue;

      // Execute action
      try {
        binding.action();
        return true;
      } catch (err) {
        console.error(`[ShortcutManager] Error executing "${binding.id}":`, err);
      }
    }

    if (currentContext === 'unit-selected' && this.quickBindingHandler) {
      for (const binding of this.quickBindings) {
        const candidate = binding.candidates.find((entry) => (
          this.eventMatchesKey(e, entry.key)
          && this.eventMatchesModifiers(e, entry.modifiers, entry.key)
        ));
        if (!candidate) continue;
        if (e.repeat) return true;
        try {
          const result = this.quickBindingHandler(binding.art);
          void Promise.resolve(result).catch((err) => {
            console.error(`[ShortcutManager] Error executing quick Art "${binding.id}":`, err);
          });
          return true;
        } catch (err) {
          console.error(`[ShortcutManager] Error executing quick Art "${binding.id}":`, err);
        }
      }
    }

    return false;
  }

  /**
   * Get all shortcut definitions for UI display
   */
  getAll(): ShortcutDef[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Get human-readable shortcut string
   */
  formatShortcut(id: string): string {
    const def = this.definitions.get(id);
    if (!def) return '';

    return (def.candidates || [{ key: def.key, modifiers: def.modifiers }])
      .map((candidate) => {
        const parts: string[] = [];
        if (candidate.modifiers.includes('ctrl')) parts.push('Ctrl');
        if (candidate.modifiers.includes('alt')) parts.push('Alt');
        if (candidate.modifiers.includes('shift')) parts.push('Shift');
        if (candidate.modifiers.includes('meta')) parts.push('Meta');
        parts.push(candidate.key === ' ' ? 'Space' : candidate.key);
        return parts.join('+');
      })
      .join(' / ');
  }

  /**
   * Check if a drag modifier is active
   */
  isDragModifierActive(e: MouseEvent, modifier: keyof typeof DRAG_MODIFIERS): boolean {
    const sourceId = modifier === 'alignment'
      ? 'drag_alignment'
      : modifier === 'dragOut'
        ? 'drag_out'
        : 'drag_cascade';
    if (this.gestureBindings.has(sourceId)) {
      return this.isGestureActive(e, sourceId);
    }
    const key = DRAG_MODIFIERS[modifier];
    switch (key) {
      case 'alt': return e.altKey;
      case 'shift': return e.shiftKey;
      case 'ctrl': return e.ctrlKey;
      case 'meta': return e.metaKey;
      default: return false;
    }
  }

  isGestureActive(
    e: Pick<MouseEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
    sourceId: string,
  ): boolean {
    const candidates = this.gestureBindings.get(sourceId) || [];
    return candidates.some((candidate) => (
      e.ctrlKey === candidate.modifiers.includes('ctrl')
      && e.altKey === candidate.modifiers.includes('alt')
      && e.shiftKey === candidate.modifiers.includes('shift')
      && e.metaKey === candidate.modifiers.includes('meta')
    ));
  }
}

// Singleton export
export const ShortcutManager = new ShortcutManagerClass();
