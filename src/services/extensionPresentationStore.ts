import { createSignal } from "solid-js";

import type { ContributionSnapshot, ExtensionContribution } from "./extensionProtocol";
import { currentExtensionWhenContext } from "./extensionContext";
import { compileExtensionWhen } from "./extensionWhen";

export type ExtensionCommandItem = {
    id: string;
    pluginId: string;
    commandId: string;
    title: string;
    placement: "hook.unit.toolbar" | "hook.commandPalette";
    order: number;
    groupId?: string;
    groupTitle?: string;
    disabledTitle?: string;
    visible: () => boolean;
    available: () => boolean;
};

export type ExtensionToolbarSlot = {
    id: string;
    title: string;
    grouped: boolean;
    items: ExtensionCommandItem[];
};

const [toolbarItems, setToolbarItems] = createSignal<ExtensionCommandItem[]>([]);
const [paletteItems, setPaletteItems] = createSignal<ExtensionCommandItem[]>([]);

const commandMap = (snapshot: ContributionSnapshot) => new Map(snapshot.contributions.commands.map((command) => [
    command.commandId ?? command.id,
    command,
]));

const nestedPayload = (contribution: ExtensionContribution): Record<string, unknown> => {
    if (!contribution.payload || typeof contribution.payload !== "object" || Array.isArray(contribution.payload)) return {};
    const outer = contribution.payload as Record<string, unknown>;
    const payload = outer.payload;
    return payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : outer;
};

const boundedPayloadString = (payload: Record<string, unknown>, key: string): string | undefined => {
    const value = payload[key];
    return typeof value === "string" && value.trim().length > 0 && value.length <= 128
        ? value.trim()
        : undefined;
};

const itemFrom = (
    menu: ExtensionContribution,
    command: ExtensionContribution,
    placement: ExtensionCommandItem["placement"],
): ExtensionCommandItem => {
    const menuPredicate = compileExtensionWhen(menu.when);
    const commandPredicate = compileExtensionWhen(command.when);
    const payload = nestedPayload(menu);
    return {
        id: menu.id,
        pluginId: menu.pluginId,
        commandId: menu.commandId ?? command.commandId ?? command.id,
        title: menu.title ?? command.title ?? command.id,
        placement,
        order: menu.order ?? 0,
        groupId: boundedPayloadString(payload, "groupId"),
        groupTitle: boundedPayloadString(payload, "groupTitle"),
        disabledTitle: boundedPayloadString(payload, "disabledTitle"),
        visible: () => menuPredicate(currentExtensionWhenContext()),
        available: () => {
            const context = currentExtensionWhenContext();
            return menuPredicate(context) && commandPredicate(context);
        },
    };
};

const ordered = (items: ExtensionCommandItem[]) => items.sort((left, right) => (
    left.order - right.order || left.id.localeCompare(right.id, "en-US")
));

export const visibleExtensionToolbarSlots = (items: ExtensionCommandItem[]): ExtensionToolbarSlot[] => {
    const slots = new Map<string, ExtensionToolbarSlot>();
    for (const item of items.filter((entry) => entry.visible())) {
        const grouped = !!item.groupId;
        const id = grouped ? `${item.pluginId}:${item.groupId}` : `${item.pluginId}:${item.id}`;
        const existing = slots.get(id);
        if (existing) {
            existing.items.push(item);
            continue;
        }
        slots.set(id, {
            id,
            title: grouped ? item.groupTitle ?? item.title : item.title,
            grouped,
            items: [item],
        });
    }
    return [...slots.values()].sort((left, right) => (
        left.items[0].order - right.items[0].order || left.id.localeCompare(right.id, "en-US")
    ));
};

export const applyExtensionPresentationSnapshot = (snapshot: ContributionSnapshot | null): void => {
    if (!snapshot) {
        setToolbarItems([]);
        setPaletteItems([]);
        return;
    }
    const commands = commandMap(snapshot);
    const toolbar: ExtensionCommandItem[] = [];
    const palette: ExtensionCommandItem[] = [];
    for (const menu of snapshot.contributions.menus) {
        const commandId = menu.commandId;
        if (!commandId) continue;
        const command = commands.get(commandId);
        if (!command) continue;
        if (menu.placement === "hook.unit.toolbar") toolbar.push(itemFrom(menu, command, menu.placement));
        if (menu.placement === "hook.commandPalette") palette.push(itemFrom(menu, command, menu.placement));
    }
    const paletteCommandIds = new Set(palette.map((item) => item.commandId));
    for (const command of snapshot.contributions.commands) {
        const commandId = command.commandId ?? command.id;
        if (paletteCommandIds.has(commandId)) continue;
        palette.push(itemFrom({ ...command, placement: "hook.commandPalette" }, command, "hook.commandPalette"));
    }
    setToolbarItems(ordered(toolbar));
    setPaletteItems(ordered(palette));
};

export const extensionPresentationStore = {
    toolbarItems,
    paletteItems,
};
