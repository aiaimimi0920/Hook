import { api } from "./api";
import { extensionBridgeClient } from "./extensionBridgeClient";
import { currentExtensionTarget } from "./extensionContext";
import { extensionRegistry } from "./extensionRegistry";
import type { ExtensionEffect, ExtensionResult } from "./extensionBridgeProtocol";
import { extensionNoticeRegistry } from "./extensionNoticeRegistry";

type CommandHandler = () => void | Promise<void>;

const gestureToken = (): string => {
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `hook-gesture:${suffix}`;
};

const effectRecord = (effect: ExtensionEffect): Record<string, unknown> => {
    if (!effect.payload || typeof effect.payload !== "object" || Array.isArray(effect.payload)) {
        throw new Error(`extension effect ${effect.type} requires an object payload`);
    }
    return effect.payload as Record<string, unknown>;
};

export const applyExtensionEffect = async (
    scopeId: string,
    unitId: string,
    effect: ExtensionEffect,
): Promise<void> => {
    const payload = effectRecord(effect);
    if (effect.type === "notice.show") {
        extensionNoticeRegistry.show(scopeId, unitId, payload);
        return;
    }
    if (effect.type === "clipboard.writeText") {
        if (typeof payload.text !== "string") throw new Error("extension clipboard effect requires text");
        const copied = await api.copyTextToClipboard(payload.text.slice(0, 1_048_576));
        if (!copied) throw new Error("extension clipboard write was denied");
        return;
    }
    throw new Error(`extension effect ${effect.type} is not implemented by this Hook host`);
};

const commandContribution = (commandId: string) => extensionRegistry
    .contributions("commands")
    .find((command) => (command.commandId ?? command.id) === commandId);

export class ExtensionCommandRouter {
    private readonly coreCommands = new Map<string, CommandHandler>();

    registerCore(commandId: string, handler: CommandHandler): () => void {
        if (this.coreCommands.has(commandId)) throw new Error(`core command ${commandId} is already registered`);
        this.coreCommands.set(commandId, handler);
        return () => {
            if (this.coreCommands.get(commandId) === handler) this.coreCommands.delete(commandId);
        };
    }

    async execute(commandId: string, input: unknown = {}): Promise<ExtensionResult | null> {
        const core = this.coreCommands.get(commandId);
        if (core) {
            await core();
            return null;
        }
        const contribution = commandContribution(commandId);
        if (!contribution) throw new Error(`extension command ${commandId} is unavailable`);
        const target = currentExtensionTarget();
        if (!target) throw new Error("extension command requires a selected unit");
        const result = await extensionBridgeClient.invoke({
            pluginId: contribution.pluginId,
            commandId,
            target,
            input,
            userGestureToken: gestureToken(),
        });
        if (result.status === "failed") {
            throw new Error(result.error?.message ?? "extension command failed");
        }
        for (const effect of result.effects) {
            await applyExtensionEffect(contribution.scopeId, target.unitId, effect);
        }
        return result;
    }
}

export const extensionCommandRouter = new ExtensionCommandRouter();
