import { unwrap } from "solid-js/store";

import { graphStore } from "../store/graphStore";
import type { UnitAttachment, UnitExtensionState } from "../types/unitExtension";
import { extensionRegistry } from "./extensionRegistry";
import {
    MAX_ATTACHMENTS_PER_UNIT,
    boundedExtensionString as boundedString,
    extensionRecord as record,
    nonNegativeExtensionInteger as nonNegativeInteger,
    parseExtensionResourceRefs as parseResourceRefs,
    validateExtensionJsonValue as validateJsonValue,
} from "./unitExtensionValidation";

const attachmentMutationTails = new Map<string, Promise<void>>();

const withUnitAttachmentMutation = async <T>(unitId: string, operation: () => Promise<T> | T): Promise<T> => {
    const previous = attachmentMutationTails.get(unitId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    attachmentMutationTails.set(unitId, tail);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (attachmentMutationTails.get(unitId) === tail) attachmentMutationTails.delete(unitId);
    }
};

const canonicalJson = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
};

const sha256 = async (value: unknown): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const activePlugin = (scopeId: string) => {
    const plugin = extensionRegistry.snapshot()?.plugins.find((item) => item.scopeId === scopeId);
    if (!plugin || !["trusted", "unsigned_developer"].includes(plugin.trustStatus)) {
        throw new Error("extension attachment owner is not active");
    }
    return plugin;
};

const assertDeclaredDataType = (scopeId: string, typeId: string): void => {
    const declared = extensionRegistry.contributions("dataTypes")
        .some((item) => item.scopeId === scopeId && item.id === typeId);
    if (!declared) throw new Error(`extension data type ${typeId} is not registered`);
};

const assertDeclaredRenderer = (scopeId: string, rendererId: string | undefined): void => {
    if (!rendererId) return;
    const declared = extensionRegistry.contributions("renderers")
        .some((item) => item.scopeId === scopeId && item.id === rendererId);
    if (!declared) throw new Error(`extension renderer ${rendererId} is not registered`);
};

const currentTargetRevision = (unitId: string): number => {
    const unit = graphStore.units.find((item) => item.id === unitId);
    if (!unit) throw new Error("extension target unit is unavailable");
    return unit.data.stickerEditPropagation?.revision ?? 0;
};

const currentState = (unitId: string): UnitExtensionState => {
    const unit = graphStore.units.find((item) => item.id === unitId);
    if (!unit) throw new Error("extension target unit is unavailable");
    return structuredClone(unwrap(unit.data.extensionState ?? {
        schemaVersion: 1,
        revision: 0,
        attachments: [],
    }));
};

const upsertUnitAttachmentUnlocked = async (
    scopeId: string,
    unitId: string,
    expectedTargetRevision: number,
    value: unknown,
): Promise<void> => {
    if (currentTargetRevision(unitId) !== expectedTargetRevision) throw new Error("extension target is stale");
    const plugin = activePlugin(scopeId);
    const source = record(value, "attachment.upsert payload");
    const attachmentId = boundedString(source.attachmentId, "attachmentId");
    if (!attachmentId.startsWith(`${plugin.id}.`)) throw new Error("attachmentId is outside the plugin namespace");
    const typeId = boundedString(source.typeId, "typeId");
    const rendererId = source.rendererId === undefined
        ? undefined
        : boundedString(source.rendererId, "rendererId");
    assertDeclaredDataType(scopeId, typeId);
    assertDeclaredRenderer(scopeId, rendererId);
    const priorRevision = nonNegativeInteger(source.priorRevision, "priorRevision");
    const revision = nonNegativeInteger(source.revision, "revision");
    if (revision !== priorRevision + 1) throw new Error("attachment revision must equal priorRevision + 1");
    const payload = source.payload === undefined ? undefined : validateJsonValue(source.payload);
    const resourceRefs = parseResourceRefs(source.resourceRefs);
    if (payload === undefined && resourceRefs.length === 0) throw new Error("attachment requires payload or resourceRefs");
    const payloadDigest = payload === undefined ? undefined : await sha256(payload);
    const currentPlugin = activePlugin(scopeId);
    if (currentPlugin.id !== plugin.id || currentPlugin.version !== plugin.version) {
        throw new Error("extension attachment owner changed during update");
    }
    if (currentTargetRevision(unitId) !== expectedTargetRevision) throw new Error("extension target is stale");
    const state = currentState(unitId);
    const index = state.attachments.findIndex((item) => item.attachmentId === attachmentId);
    const previous = index >= 0 ? state.attachments[index] : undefined;
    if ((previous?.revision ?? 0) !== priorRevision) throw new Error("attachment compare-and-swap failed");
    if (previous && previous.pluginId !== plugin.id) throw new Error("extension cannot replace another plugin attachment");
    if (!previous && state.attachments.length >= MAX_ATTACHMENTS_PER_UNIT) {
        throw new Error("unit attachment count exceeds the budget");
    }
    const attachment: UnitAttachment = {
        attachmentId,
        typeId,
        schemaVersion: boundedString(source.schemaVersion, "schemaVersion", 64),
        revision,
        pluginId: plugin.id,
        pluginVersion: plugin.version,
        rendererId,
        payload,
        payloadDigest,
        resourceRefs,
    };
    if (index >= 0) state.attachments[index] = attachment;
    else state.attachments.push(attachment);
    graphStore.actions.updateUnitData(unitId, { extensionState: { ...state, revision: state.revision + 1 } });
};

const removeUnitAttachmentUnlocked = (
    scopeId: string,
    unitId: string,
    expectedTargetRevision: number,
    value: unknown,
): void => {
    if (currentTargetRevision(unitId) !== expectedTargetRevision) throw new Error("extension target is stale");
    const plugin = activePlugin(scopeId);
    const source = record(value, "attachment.remove payload");
    const attachmentId = boundedString(source.attachmentId, "attachmentId");
    if (!attachmentId.startsWith(`${plugin.id}.`)) throw new Error("attachmentId is outside the plugin namespace");
    const priorRevision = nonNegativeInteger(source.priorRevision, "priorRevision");
    const state = currentState(unitId);
    const attachment = state.attachments.find((item) => item.attachmentId === attachmentId);
    if (!attachment || attachment.revision !== priorRevision) throw new Error("attachment compare-and-swap failed");
    if (attachment.pluginId !== plugin.id) throw new Error("extension cannot remove another plugin attachment");
    graphStore.actions.updateUnitData(unitId, {
        extensionState: {
            ...state,
            revision: state.revision + 1,
            attachments: state.attachments.filter((item) => item.attachmentId !== attachmentId),
        },
    });
};

export const upsertUnitAttachment = (
    scopeId: string,
    unitId: string,
    expectedTargetRevision: number,
    value: unknown,
): Promise<void> => withUnitAttachmentMutation(
    unitId,
    () => upsertUnitAttachmentUnlocked(scopeId, unitId, expectedTargetRevision, value),
);

export const removeUnitAttachment = (
    scopeId: string,
    unitId: string,
    expectedTargetRevision: number,
    value: unknown,
): Promise<void> => withUnitAttachmentMutation(
    unitId,
    () => removeUnitAttachmentUnlocked(scopeId, unitId, expectedTargetRevision, value),
);
