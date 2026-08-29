import { compileExtensionWhen } from "./extensionWhen";

export const EXTENSION_PROTOCOL = "loom.extension.v1" as const;
export const EXTENSION_API_VERSION = "1.0" as const;

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_PLUGINS = 128;
const MAX_CONTRIBUTIONS = 2048;
const CONTRIBUTION_LISTS = [
    "commands",
    "shortcuts",
    "menus",
    "settings",
    "dataTypes",
    "renderers",
    "unitOverlays",
    "backgroundTasks",
    "resourceProviders",
    "diagnostics",
    "eventSubscriptions",
] as const;

export type ExtensionContributionKind = typeof CONTRIBUTION_LISTS[number];
export type ExtensionTrustStatus = "trusted" | "unsigned_developer" | "revoked" | "untrusted";

export interface ExtensionPluginBinding {
    id: string;
    version: string;
    packageDigest: string;
    trustStatus: ExtensionTrustStatus;
    permissionGrantDigest: string;
    scopeId: string;
}

export interface ExtensionContribution {
    id: string;
    pluginId: string;
    scopeId: string;
    title?: string;
    commandId?: string;
    when?: string;
    placement?: string;
    order?: number;
    payload?: unknown;
}

export type ExtensionContributions = Record<ExtensionContributionKind, ExtensionContribution[]>;

export interface ContributionSnapshot {
    protocol: typeof EXTENSION_PROTOCOL;
    apiVersion: string;
    generation: number;
    plugins: ExtensionPluginBinding[];
    contributions: ExtensionContributions;
}

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
};

const assertKeys = (record: Record<string, unknown>, allowed: readonly string[], field: string): void => {
    const allowedKeys = new Set(allowed);
    for (const key of Object.keys(record)) {
        if (!allowedKeys.has(key)) throw new Error(`${field} contains unknown field ${key}`);
    }
};

const asString = (value: unknown, field: string, maximum = 384): string => {
    if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
        throw new Error(`${field} must be a bounded non-empty string`);
    }
    return value;
};

const asDigest = (value: unknown, field: string): string => {
    const digest = asString(value, field, 64);
    if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error(`${field} must be lowercase SHA-256`);
    return digest;
};

const asApiVersion = (value: unknown): string => {
    const version = asString(value, "apiVersion", 32);
    const match = /^(\d+)\.(\d+)$/u.exec(version);
    if (!match || match[1] !== "1") throw new Error(`unsupported extension API ${version}`);
    return version;
};

const parsePlugin = (value: unknown, index: number): ExtensionPluginBinding => {
    const field = `plugins[${index}]`;
    const record = asRecord(value, field);
    assertKeys(record, [
        "id",
        "version",
        "packageDigest",
        "trustStatus",
        "permissionGrantDigest",
        "scopeId",
    ], field);
    const trustStatus = asString(record.trustStatus, `${field}.trustStatus`, 32);
    if (!["trusted", "unsigned_developer", "revoked", "untrusted"].includes(trustStatus)) {
        throw new Error(`${field}.trustStatus is unsupported`);
    }
    return {
        id: asString(record.id, `${field}.id`),
        version: asString(record.version, `${field}.version`, 128),
        packageDigest: asDigest(record.packageDigest, `${field}.packageDigest`),
        trustStatus: trustStatus as ExtensionTrustStatus,
        permissionGrantDigest: asDigest(record.permissionGrantDigest, `${field}.permissionGrantDigest`),
        scopeId: asString(record.scopeId, `${field}.scopeId`),
    };
};

const parseContribution = (value: unknown, field: string): ExtensionContribution => {
    const record = asRecord(value, field);
    assertKeys(record, [
        "id",
        "pluginId",
        "scopeId",
        "title",
        "commandId",
        "when",
        "placement",
        "order",
        "payload",
    ], field);
    const optionalString = (key: "title" | "commandId" | "when" | "placement", maximum: number) =>
        record[key] === undefined ? undefined : asString(record[key], `${field}.${key}`, maximum);
    if (record.order !== undefined && (!Number.isSafeInteger(record.order) || Number(record.order) < -10000 || Number(record.order) > 10000)) {
        throw new Error(`${field}.order is outside the supported range`);
    }
    return {
        id: asString(record.id, `${field}.id`),
        pluginId: asString(record.pluginId, `${field}.pluginId`),
        scopeId: asString(record.scopeId, `${field}.scopeId`),
        title: optionalString("title", 128),
        commandId: optionalString("commandId", 384),
        when: optionalString("when", 2048),
        placement: optionalString("placement", 128),
        order: record.order === undefined ? undefined : Number(record.order),
        payload: record.payload,
    };
};

export const parseContributionSnapshot = (value: unknown): ContributionSnapshot => {
    let encoded: string;
    try {
        encoded = JSON.stringify(value);
    } catch {
        throw new Error("extension snapshot must be JSON serializable");
    }
    if (new TextEncoder().encode(encoded).byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("extension snapshot exceeds the byte budget");
    }
    const record = asRecord(value, "snapshot");
    assertKeys(record, ["protocol", "apiVersion", "generation", "plugins", "contributions"], "snapshot");
    if (record.protocol !== EXTENSION_PROTOCOL) throw new Error("unsupported extension protocol");
    if (!Number.isSafeInteger(record.generation) || Number(record.generation) < 0) {
        throw new Error("snapshot generation must be a non-negative integer");
    }
    if (!Array.isArray(record.plugins) || record.plugins.length > MAX_PLUGINS) {
        throw new Error("snapshot plugin count exceeds the budget");
    }
    const plugins = record.plugins.map(parsePlugin);
    const pluginScopes = new Map<string, string>();
    for (const plugin of plugins) {
        if (pluginScopes.has(plugin.id)) throw new Error(`duplicate plugin ${plugin.id}`);
        pluginScopes.set(plugin.id, plugin.scopeId);
    }

    const rawContributions = asRecord(record.contributions, "contributions");
    assertKeys(rawContributions, CONTRIBUTION_LISTS, "contributions");
    const contributions = {} as ExtensionContributions;
    const contributionIds = new Set<string>();
    let total = 0;
    for (const kind of CONTRIBUTION_LISTS) {
        const list = rawContributions[kind];
        if (!Array.isArray(list) || list.length > 256) throw new Error(`${kind} is not a bounded list`);
        contributions[kind] = list.map((item, index) => {
            const contribution = parseContribution(item, `${kind}[${index}]`);
            const foldedId = contribution.id.toLocaleLowerCase("en-US");
            if (contributionIds.has(foldedId)) throw new Error(`duplicate contribution ${contribution.id}`);
            contributionIds.add(foldedId);
            if (pluginScopes.get(contribution.pluginId) !== contribution.scopeId) {
                throw new Error(`contribution ${contribution.id} has no matching plugin scope`);
            }
            compileExtensionWhen(contribution.when);
            return contribution;
        });
        total += list.length;
    }
    if (total > MAX_CONTRIBUTIONS) throw new Error("snapshot contribution count exceeds the budget");
    return {
        protocol: EXTENSION_PROTOCOL,
        apiVersion: asApiVersion(record.apiVersion),
        generation: Number(record.generation),
        plugins,
        contributions,
    };
};
