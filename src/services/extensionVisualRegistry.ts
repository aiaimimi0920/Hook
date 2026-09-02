import { createSignal } from "solid-js";

import type { UnitAttachment } from "../types/unitExtension";
import type { SurfaceNode } from "./surfaceProtocol";
import type { ContributionSnapshot, ExtensionContribution } from "./extensionProtocol";

const MAX_VISUALS = 32;
const MAX_NODES = 64;
const MAX_CLICKABLE_NODES = 16;
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_ATTACHMENT_SCENE_NODES = 512;
const MAX_ATTACHMENT_SCENE_CLICKABLE_NODES = 256;
const MAX_ATTACHMENT_SCENE_BYTES = 256 * 1024;
const MAX_ATTACHMENT_SCENE_PATH_SEGMENTS = 8;
const MAX_SCENE_DEPTH = 32;
const ALLOWED_NODE_TYPES = new Set([
    "row", "column", "stack", "text", "icon", "button", "textarea", "progress", "divider", "spacer",
]);

export interface ExtensionVisualBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ExtensionVisualDescriptor {
    id: string;
    kind: "renderer" | "overlay";
    pluginId: string;
    pluginVersion: string;
    scopeId: string;
    typeId: string;
    commandId?: string;
    bounds: ExtensionVisualBounds;
    scene?: SurfaceNode;
    attachmentScenePath?: string[];
    generation: number;
}

interface ExtensionVisualState {
    activePluginIds: ReadonlySet<string>;
    dataTypeIds: ReadonlySet<string>;
    renderers: readonly ExtensionVisualDescriptor[];
    overlays: readonly ExtensionVisualDescriptor[];
    rejectedContributions: number;
}

const emptyState = (): ExtensionVisualState => ({
    activePluginIds: new Set(),
    dataTypeIds: new Set(),
    renderers: [],
    overlays: [],
    rejectedContributions: 0,
});

const [visualState, setVisualState] = createSignal<ExtensionVisualState>(emptyState());

const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;

const boundedString = (value: unknown, maximum = 384): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;

const finiteNumber = (value: unknown, minimum: number, maximum: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value
        : null;

const parseBounds = (value: unknown): ExtensionVisualBounds | null => {
    const source = record(value);
    if (!source) return null;
    const x = finiteNumber(source.x, 0, 8_192);
    const y = finiteNumber(source.y, 0, 8_192);
    const width = finiteNumber(source.width, 1, 8_192);
    const height = finiteNumber(source.height, 1, 8_192);
    return x === null || y === null || width === null || height === null
        ? null
        : { x, y, width, height };
};

interface SceneBudget {
    nodes: number;
    clickableNodes: number;
    bytes: number;
}

const sanitizeScene = (
    value: unknown,
    commandId: string | undefined,
    budget: SceneBudget = {
        nodes: MAX_NODES,
        clickableNodes: MAX_CLICKABLE_NODES,
        bytes: MAX_TEXT_BYTES,
    },
): SurfaceNode | null => {
    const seen = new Set<string>();
    let nodes = 0;
    let clickable = 0;
    let textBytes = 0;
    const sanitize = (candidate: unknown, depth = 0): SurfaceNode | null => {
        const source = record(candidate);
        if (!source || nodes >= budget.nodes || depth > MAX_SCENE_DEPTH) return null;
        const id = boundedString(source.id, 128);
        const type = boundedString(source.type, 32);
        if (!id || !type || seen.has(id) || !ALLOWED_NODE_TYPES.has(type)) return null;
        nodes += 1;
        seen.add(id);
        const cloneJson = (item: unknown): unknown => {
            if (item === undefined) return undefined;
            const encoded = JSON.stringify(item);
            textBytes += new TextEncoder().encode(encoded).byteLength;
            if (textBytes > budget.bytes) throw new Error("extension Surface text budget exceeded");
            return JSON.parse(encoded) as unknown;
        };
        try {
            const rawChildren = source.children === undefined ? [] : source.children;
            if (!Array.isArray(rawChildren)) return null;
            const children = rawChildren.map((child) => sanitize(child, depth + 1));
            if (children.some((child) => child === null)) return null;
            const events = record(source.events);
            const clickAction = boundedString(events?.click, 384);
            const safeClick = commandId && clickAction === commandId && clickable < budget.clickableNodes
                ? clickAction
                : undefined;
            if (safeClick) clickable += 1;
            return {
                id,
                type,
                props: cloneJson(source.props),
                layout: cloneJson(source.layout),
                style: cloneJson(source.style),
                accessibility: cloneJson(source.accessibility),
                events: safeClick ? { click: safeClick } : undefined,
                children: children as SurfaceNode[],
            };
        } catch {
            return null;
        }
    };
    return sanitize(value);
};

const parseAttachmentScenePath = (value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.startsWith("/")) return undefined;
    const segments = value.slice(1).split("/");
    if (
        segments.length === 0 ||
        segments.length > MAX_ATTACHMENT_SCENE_PATH_SEGMENTS ||
        segments.some((segment) => !/^[a-zA-Z0-9_-]{1,64}$/u.test(segment))
    ) return undefined;
    return segments;
};

const valueAtPath = (value: unknown, path: readonly string[]): unknown => {
    let current = value;
    for (const segment of path) {
        const source = record(current);
        if (!source || !Object.prototype.hasOwnProperty.call(source, segment)) return undefined;
        current = source[segment];
    }
    return current;
};

const parseVisual = (
    contribution: ExtensionContribution,
    snapshot: ContributionSnapshot,
    kind: ExtensionVisualDescriptor["kind"],
): ExtensionVisualDescriptor | null => {
    const envelope = record(contribution.payload);
    const expectedSchema = kind === "renderer" ? "renderer.v1" : "unit-overlay.v1";
    if (envelope?.schema !== expectedSchema) return null;
    const payload = record(envelope.payload);
    const typeId = boundedString(payload?.typeId);
    const bounds = parseBounds(payload?.bounds);
    const plugin = snapshot.plugins.find((item) =>
        item.id === contribution.pluginId &&
        item.scopeId === contribution.scopeId &&
        ["trusted", "unsigned_developer"].includes(item.trustStatus));
    if (!payload || !typeId || !bounds || !plugin) return null;
    const commandId = contribution.commandId;
    if (commandId && !snapshot.contributions.commands.some((item) =>
        item.pluginId === contribution.pluginId &&
        item.scopeId === contribution.scopeId &&
        (item.commandId ?? item.id) === commandId)) return null;
    const attachmentScenePath = parseAttachmentScenePath(payload.attachmentScenePath);
    if (payload.attachmentScenePath !== undefined && !attachmentScenePath) return null;
    const scene = payload.scene === undefined
        ? undefined
        : sanitizeScene(payload.scene, commandId) ?? undefined;
    if (!scene && !attachmentScenePath) return null;
    return {
        id: contribution.id,
        kind,
        pluginId: contribution.pluginId,
        pluginVersion: plugin.version,
        scopeId: contribution.scopeId,
        typeId,
        commandId,
        bounds,
        scene,
        attachmentScenePath,
        generation: snapshot.generation,
    };
};

export const applyExtensionVisualSnapshot = (snapshot: ContributionSnapshot | null): void => {
    if (!snapshot) {
        setVisualState(emptyState());
        return;
    }
    const activePlugins = snapshot.plugins.filter((plugin) =>
        ["trusted", "unsigned_developer"].includes(plugin.trustStatus));
    const activeScopes = new Set(activePlugins.map((plugin) => plugin.scopeId));
    const dataTypeIds = new Set(snapshot.contributions.dataTypes
        .filter((item) => activeScopes.has(item.scopeId))
        .map((item) => item.id));
    let rejectedContributions = 0;
    const parseList = (
        values: readonly ExtensionContribution[],
        kind: ExtensionVisualDescriptor["kind"],
    ) => values.slice(0, MAX_VISUALS).flatMap((value) => {
        const parsed = parseVisual(value, snapshot, kind);
        if (!parsed || !dataTypeIds.has(parsed.typeId)) {
            rejectedContributions += 1;
            return [];
        }
        return [parsed];
    });
    setVisualState({
        activePluginIds: new Set(activePlugins.map((plugin) => plugin.id)),
        dataTypeIds,
        renderers: parseList(snapshot.contributions.renderers, "renderer"),
        overlays: parseList(snapshot.contributions.unitOverlays, "overlay"),
        rejectedContributions,
    });
};

export const extensionVisualRegistry = {
    state: visualState,
    rendererFor: (attachment: UnitAttachment) => visualState().renderers.find((renderer) =>
        renderer.pluginId === attachment.pluginId &&
        renderer.typeId === attachment.typeId &&
        (!attachment.rendererId || renderer.id === attachment.rendererId)),
    overlaysFor: (attachment: UnitAttachment) => visualState().overlays.filter((overlay) =>
        overlay.pluginId === attachment.pluginId && overlay.typeId === attachment.typeId),
    attachmentAvailable: (attachment: UnitAttachment) =>
        visualState().activePluginIds.has(attachment.pluginId) &&
        visualState().dataTypeIds.has(attachment.typeId),
    sceneFor: (descriptor: ExtensionVisualDescriptor, attachment: UnitAttachment) => {
        if (!descriptor.attachmentScenePath) return descriptor.scene;
        return sanitizeScene(
            valueAtPath(attachment.payload, descriptor.attachmentScenePath),
            descriptor.commandId,
            {
                nodes: MAX_ATTACHMENT_SCENE_NODES,
                clickableNodes: MAX_ATTACHMENT_SCENE_CLICKABLE_NODES,
                bytes: MAX_ATTACHMENT_SCENE_BYTES,
            },
        ) ?? descriptor.scene;
    },
    diagnostics: () => ({
        dataTypes: visualState().dataTypeIds.size,
        renderers: visualState().renderers.length,
        unitOverlays: visualState().overlays.length,
        rejectedContributions: visualState().rejectedContributions,
    }),
};
