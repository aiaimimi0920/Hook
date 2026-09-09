import { api } from "./api";
import { extensionBridgeClient } from "./extensionBridgeClient";
import { currentExtensionTarget, currentExtensionUnit } from "./extensionContext";
import { extensionRegistry } from "./extensionRegistry";
import { extensionContributionPayload } from "./extensionProtocol";
import type { ExtensionEffect, ExtensionResult } from "./extensionBridgeProtocol";
import { extensionNoticeRegistry } from "./extensionNoticeRegistry";
import { removeUnitAttachment, upsertUnitAttachment } from "./unitAttachmentStore";
import { parseUnitImageDataUrl, resolveUnitImageDataUrl } from "./unitImageSource";
import { isDirectSurfaceClick, normalizeExternalHttpsUrl } from "./externalUrlEffect";

type CommandHandler = () => void | Promise<void>;
type EffectContext = { directSurfaceClick?: boolean };
const MAX_EXTENSION_IMAGE_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MARGIN_MS = 10_000;
const IMAGE_READ_PERMISSION = "hook.unit.image.read";
const ATTACHMENT_READ_PERMISSION = "hook.unit.attachments.read";
const MAX_EFFECT_FAILURE_DETAILS = 3;
const MAX_EFFECT_FAILURE_DETAIL_LENGTH = 256;

export const gestureToken = (): string => {
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
    expectedTargetRevision: number,
    context: EffectContext = {},
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
    if (effect.type === "external.openUrl") {
        if (!context.directSurfaceClick) {
            throw new Error("extension external URL requires a direct Surface click");
        }
        await api.openExternalHttpsUrl(normalizeExternalHttpsUrl(payload.url));
        return;
    }
    if (effect.type === "attachment.upsert") {
        await upsertUnitAttachment(scopeId, unitId, expectedTargetRevision, payload);
        return;
    }
    if (effect.type === "attachment.remove") {
        await removeUnitAttachment(scopeId, unitId, expectedTargetRevision, payload);
        return;
    }
    throw new Error(`extension effect ${effect.type} is not implemented by this Hook host`);
};

const commandContribution = (commandId: string) => extensionRegistry
    .contributions("commands")
    .find((command) => (command.commandId ?? command.id) === commandId);

/**
 * Reads the runtime budget the plugin declared for this command.
 *
 * The bridge client would otherwise apply its own short default and reject a
 * long-running command — OCR recognition asks for 60 s — while the runtime is
 * still producing a result. The extra margin covers request and response
 * transfer, which for an image upload is not free.
 */
const commandTimeoutMs = (payload: unknown): number | undefined => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const declared = (payload as Record<string, unknown>).timeoutMs;
    if (typeof declared !== "number" || !Number.isFinite(declared) || declared <= 0) return undefined;
    return Math.trunc(declared) + COMMAND_TIMEOUT_MARGIN_MS;
};

/**
 * Reports whether the command declared that it needs a user gesture.
 *
 * Only a declared command gets a token: the runtime records every token it
 * accepts on the session, and minting one for a command that never checks it
 * spends a replay-window slot for nothing. An absent or malformed declaration
 * still gets a token, because withholding one would fail a command that does
 * require it.
 */
const requiresUserGesture = (payload: unknown): boolean => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
    return (payload as Record<string, unknown>).requiresUserGesture !== false;
};

const contributionPermissions = (payload: unknown): Set<string> => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return new Set();
    const permissions = (payload as Record<string, unknown>).permissions;
    if (!Array.isArray(permissions) || permissions.length > 64) return new Set();
    const values = permissions.filter((permission): permission is string => (
        typeof permission === "string" && permission.length > 0 && permission.length <= 128
    ));
    return values.length === permissions.length ? new Set(values) : new Set();
};

const resolveCommandResourceUploads = async (
    permissions: ReadonlySet<string>,
    target: { unitId: string; revision: number },
) => {
    if (!permissions.has(IMAGE_READ_PERMISSION)) return [];
    const unit = currentExtensionUnit();
    if (!unit || unit.id !== target.unitId) throw new Error("extension image target is stale");
    const dataUrl = await resolveUnitImageDataUrl(
        { src: unit.data.src ?? unit.data.previewSrc, filePath: unit.data.filePath },
        { readImageFromPath: api.readImageFromPath },
        MAX_EXTENSION_IMAGE_BYTES,
    );
    const currentTarget = currentExtensionTarget();
    if (!currentTarget
        || currentTarget.unitId !== target.unitId
        || currentTarget.revision !== target.revision) {
        throw new Error("extension image target changed while preparing the command");
    }
    const image = parseUnitImageDataUrl(dataUrl, MAX_EXTENSION_IMAGE_BYTES);
    return [{ kind: "image" as const, mime: image.mime, dataBase64: image.dataBase64 }];
};

const resolveCommandUnitAttachments = (
    permissions: ReadonlySet<string>,
    target: { unitId: string; revision: number },
    pluginId: string,
) => {
    if (!permissions.has(ATTACHMENT_READ_PERMISSION)) return [];
    const unit = currentExtensionUnit();
    if (!unit || unit.id !== target.unitId) throw new Error("extension attachment target is stale");
    // v1 exposes only the invoking plugin's opaque state. Cross-plugin data
    // sharing requires a future, explicitly declared compatibility contract.
    return (unit.data.extensionState?.attachments ?? [])
        .filter((attachment) => attachment.pluginId === pluginId)
        .map((attachment) => ({
            attachmentId: attachment.attachmentId,
            typeId: attachment.typeId,
            schemaVersion: attachment.schemaVersion,
            revision: attachment.revision,
            pluginId: attachment.pluginId,
            pluginVersion: attachment.pluginVersion,
            ...(attachment.rendererId ? { rendererId: attachment.rendererId } : {}),
            ...(attachment.payload === undefined ? {} : { payload: attachment.payload }),
            resourceRefs: attachment.resourceRefs,
        }));
};

const reportExtensionEffectFailures = (
    scopeId: string,
    unitId: string,
    failures: readonly string[],
): void => {
    const details = failures
        .slice(0, MAX_EFFECT_FAILURE_DETAILS)
        .map((failure) => failure.slice(0, MAX_EFFECT_FAILURE_DETAIL_LENGTH))
        .join("; ");
    const omitted = failures.length - Math.min(failures.length, MAX_EFFECT_FAILURE_DETAILS);
    const diagnostic = `${details}${omitted > 0 ? `; ${omitted} more failure(s)` : ""}`;
    const message = `${failures.length} 个扩展操作未完成，其他结果已保留。请查看日志了解详情。`;
    console.error("[Hook extensions] command effects partially failed", diagnostic);
    try {
        extensionNoticeRegistry.show(scopeId, unitId, {
            title: "扩展操作部分未完成",
            message,
        });
    } catch {
        // Reporting must not turn an already-successful runtime command into a
        // rejected command or recursively produce another extension effect.
        console.error("[Hook extensions] failed to display the partial-failure notice");
    }
};

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
        const payload = extensionContributionPayload(contribution);
        const permissions = contributionPermissions(payload);
        const resourceUploads = await resolveCommandResourceUploads(permissions, target);
        const unitAttachments = resolveCommandUnitAttachments(permissions, target, contribution.pluginId);
        const result = await extensionBridgeClient.invoke({
            pluginId: contribution.pluginId,
            commandId,
            target,
            input,
            resourceUploads,
            unitAttachments,
            userGestureToken: requiresUserGesture(payload) ? gestureToken() : undefined,
            timeoutMs: commandTimeoutMs(payload),
        });
        if (result.status === "failed") {
            throw new Error(result.error?.message ?? "extension command failed");
        }
        // Effects are independent of one another: an OCR run emits an attachment
        // upsert, a clipboard write and a notice together. Attempt all effects so a
        // stale attachment CAS does not also discard clipboard output, then reject
        // once so command callers cannot mistake a partially applied result for
        // complete success.
        const failures: string[] = [];
        for (const effect of result.effects) {
            try {
                await applyExtensionEffect(contribution.scopeId, target.unitId, effect, target.revision, {
                    directSurfaceClick: isDirectSurfaceClick(input, commandId),
                });
            } catch (error) {
                failures.push(error instanceof Error ? error.message : String(error));
            }
        }
        if (failures.length > 0) {
            reportExtensionEffectFailures(contribution.scopeId, target.unitId, failures);
            throw new Error(`${failures.length} extension effect(s) failed`);
        }
        return result;
    }
}

export const extensionCommandRouter = new ExtensionCommandRouter();
