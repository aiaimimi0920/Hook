import { DEFAULT_SHORTCUTS, parseShortcutAlternatives, type ShortcutCandidate } from "./shortcuts";
import { extensionContributionPayload, type ContributionSnapshot } from "./extensionProtocol";
import { compileExtensionWhen, type ExtensionWhenPredicate } from "./extensionWhen";
import { currentExtensionWhenContext } from "./extensionContext";
import { extensionCommandRouter } from "./extensionCommandRouter";

export type ExtensionShortcutBinding = {
    id: string;
    commandId: string;
    candidate: ShortcutCandidate;
    global: boolean;
    available: ExtensionWhenPredicate;
};

export type NativeExtensionShortcut = {
    id: string;
    key: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    global: boolean;
};

const canonical = (candidate: ShortcutCandidate): string => [
    ...candidate.modifiers.map((modifier) => modifier.toLowerCase()).sort(),
    candidate.key.toLowerCase(),
].join("+");

const RESERVED = new Set([
    ...DEFAULT_SHORTCUTS.flatMap((shortcut) => (
        shortcut.candidates ?? [{ key: shortcut.key, modifiers: shortcut.modifiers }]
    )).map(canonical),
    "ctrl+1",
    "ctrl+2",
    "ctrl+3",
    "ctrl+shift+p",
]);

export const buildExtensionShortcutBindings = (snapshot: ContributionSnapshot): {
    accepted: ExtensionShortcutBinding[];
    rejected: string[];
} => {
    const accepted: ExtensionShortcutBinding[] = [];
    const rejected: string[] = [];
    const occupied = new Set<string>();
    const shortcuts = [...snapshot.contributions.shortcuts].sort((left, right) => (
        (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id, "en-US")
    ));
    for (const shortcut of shortcuts) {
        const payload = extensionContributionPayload(shortcut);
        const keys = payload.keys;
        const commandId = shortcut.commandId;
        const candidates = typeof keys === "string" ? parseShortcutAlternatives(keys) : [];
        if (!commandId || candidates.length === 0) {
            rejected.push(shortcut.id);
            continue;
        }
        const available = compileExtensionWhen(shortcut.when);
        for (const candidate of candidates) {
            const key = canonical(candidate);
            if (RESERVED.has(key) || occupied.has(key)) {
                rejected.push(shortcut.id);
                continue;
            }
            occupied.add(key);
            accepted.push({
                id: shortcut.id,
                commandId,
                candidate,
                global: payload.global === true,
                available,
            });
        }
    }
    return { accepted, rejected };
};

const eventMatches = (event: KeyboardEvent, candidate: ShortcutCandidate): boolean => {
    const modifiers = new Set(candidate.modifiers);
    const keyMatches = event.key.toLowerCase() === candidate.key.toLowerCase()
        || (/^[a-z]$/iu.test(candidate.key) && event.code === `Key${candidate.key.toUpperCase()}`)
        || (/^[0-9]$/u.test(candidate.key) && event.code === `Digit${candidate.key}`);
    return keyMatches
        && event.ctrlKey === modifiers.has("ctrl")
        && event.altKey === modifiers.has("alt")
        && event.shiftKey === modifiers.has("shift")
        && event.metaKey === modifiers.has("meta");
};

export class ExtensionShortcutRegistry {
    private bindings: ExtensionShortcutBinding[] = [];

    applySnapshot(snapshot: ContributionSnapshot | null): string[] {
        if (!snapshot) {
            this.bindings = [];
            return [];
        }
        const next = buildExtensionShortcutBindings(snapshot);
        this.bindings = next.accepted;
        return next.rejected;
    }

    nativeRegistrations(): NativeExtensionShortcut[] {
        return this.bindings.map((binding) => ({
            id: binding.id,
            key: binding.candidate.key,
            ctrl: binding.candidate.modifiers.includes("ctrl"),
            alt: binding.candidate.modifiers.includes("alt"),
            shift: binding.candidate.modifiers.includes("shift"),
            meta: binding.candidate.modifiers.includes("meta"),
            global: binding.global,
        }));
    }

    handleKeyDown = (event: KeyboardEvent): void => {
        // Native shortcuts dispatch on Window, not necessarily a DOM element.
        const target = event.target instanceof Element ? event.target : null;
        if (
            (target instanceof HTMLElement && target.isContentEditable)
            || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
            || target?.closest("[data-hook-global-shortcuts='ignore']")
        ) return;
        const binding = this.bindings.find((entry) => (
            entry.available(currentExtensionWhenContext()) && eventMatches(event, entry.candidate)
        ));
        if (!binding) return;
        event.preventDefault();
        event.stopPropagation();
        void extensionCommandRouter.execute(binding.commandId).catch((error) => {
            console.error(`Extension shortcut ${binding.id} failed`, error);
        });
    };
}

export const extensionShortcutRegistry = new ExtensionShortcutRegistry();
