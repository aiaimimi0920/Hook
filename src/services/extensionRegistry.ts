import {
    parseContributionSnapshot,
    type ContributionSnapshot,
    type ExtensionContribution,
    type ExtensionContributionKind,
} from "./extensionProtocol";

export type ExtensionRegistryListener = (snapshot: ContributionSnapshot | null) => void;

/** Owns one authenticated Hook session and swaps only fully validated snapshots. */
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
        return this.current?.contributions[kind] ?? [];
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
