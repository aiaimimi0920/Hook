import {
    parseContributionSnapshot,
    isTrustedExtensionContribution,
    type ContributionSnapshot,
    type ExtensionContribution,
    type ExtensionContributionKind,
} from "./extensionProtocol";

export type ExtensionRegistryListener = (snapshot: ContributionSnapshot | null) => void;

/** Owns one negotiated Hook session; peer authentication is a separate transport boundary. */
export class ExtensionRegistry {
    private sessionId: string | null = null;
    private current: ContributionSnapshot | null = null;
    private readonly listeners = new Set<ExtensionRegistryListener>();

    beginSession(sessionId: string): void {
        if (!sessionId) throw new Error("extension session id is required");
        this.sessionId = sessionId;
        this.replace(null);
    }

    applySnapshot(sessionId: string, value: unknown): ContributionSnapshot {
        if (sessionId !== this.sessionId) throw new Error("stale extension session");
        const next = parseContributionSnapshot(value);
        if (this.current && next.generation <= this.current.generation) {
            throw new Error("stale extension generation");
        }
        this.replace(next);
        return next;
    }

    disconnect(sessionId: string): void {
        if (sessionId !== this.sessionId) return;
        this.sessionId = null;
        this.replace(null);
    }

    snapshot(): ContributionSnapshot | null {
        return this.current;
    }

    contributions(kind: ExtensionContributionKind): readonly ExtensionContribution[] {
        const snapshot = this.current;
        if (!snapshot) return [];
        return snapshot.contributions[kind].filter((item) => isTrustedExtensionContribution(snapshot, item));
    }

    /** Freeze an invocation to the exact session and host-owned snapshot it began with. */
    captureAuthority(contribution: ExtensionContribution): {
        permissions: ReadonlySet<string>;
        assertCurrent: () => void;
    } {
        const sessionId = this.sessionId;
        const snapshot = this.current;
        const owner = snapshot?.plugins.find((plugin) => plugin.id === contribution.pluginId
            && plugin.scopeId === contribution.scopeId && plugin.trustStatus === "trusted");
        if (!sessionId || !snapshot || !owner
            || !snapshot.contributions.commands.includes(contribution)) {
            throw new Error("extension command has no trusted authority");
        }
        return {
            permissions: new Set(owner.effectivePermissions ?? []),
            assertCurrent: () => {
                if (this.sessionId !== sessionId || this.current !== snapshot) {
                    throw new Error("extension command authority changed");
                }
            },
        };
    }

    diagnostics(): { plugins: number; contributions: number; listeners: number } {
        const contributions = this.current
            ? Object.values(this.current.contributions).reduce((total, list) => total + list.length, 0)
            : 0;
        return { plugins: this.current?.plugins.length ?? 0, contributions, listeners: this.listeners.size };
    }

    subscribe(listener: ExtensionRegistryListener): () => void {
        this.listeners.add(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.listeners.delete(listener);
        };
    }

    private replace(snapshot: ContributionSnapshot | null): void {
        this.current = snapshot;
        for (const listener of this.listeners) listener(snapshot);
    }
}

export const extensionRegistry = new ExtensionRegistry();
