import { createSignal } from "solid-js";

import type { ContributionSnapshot, ExtensionContribution } from "./extensionProtocol";
import { currentExtensionWhenContext } from "./extensionContext";
import { compileExtensionWhen } from "./extensionWhen";

export type ExtensionCommandItem = {
    id: string;
    commandId: string;
    title: string;
    placement: "hook.unit.toolbar" | "hook.commandPalette";
    order: number;
    available: () => boolean;
};

const [toolbarItems, setToolbarItems] = createSignal<ExtensionCommandItem[]>([]);
const [paletteItems, setPaletteItems] = createSignal<ExtensionCommandItem[]>([]);

const commandMap = (snapshot: ContributionSnapshot) => new Map(snapshot.contributions.commands.map((command) => [
    command.commandId ?? command.id,
    command,
]));

const itemFrom = (
    menu: ExtensionContribution,
    command: ExtensionContribution,
    placement: ExtensionCommandItem["placement"],
): ExtensionCommandItem => {
    const predicate = compileExtensionWhen(menu.when ?? command.when);
    return {
        id: menu.id,
        commandId: menu.commandId ?? command.commandId ?? command.id,
        title: menu.title ?? command.title ?? command.id,
        placement,
        order: menu.order ?? 0,
        available: () => predicate(currentExtensionWhenContext()),
    };
};

const ordered = (items: ExtensionCommandItem[]) => items.sort((left, right) => (
    left.order - right.order || left.id.localeCompare(right.id, "en-US")
));

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
