// Reuse only native-committed assets, without changing the pixels used by Loom or the UI.
import type { SessionSticker } from "../types/unit";
import type { SessionImageAsset, SessionSaveResult } from "./apiTypes";

type Slot = "src" | "previewSrc";
type Asset = { value: string; path: string };
type References = Partial<Record<Slot, Asset>>;
const slots: Slot[] = ["src", "previewSrc"];

export class SessionAssetReferences {
    private readonly references = new Map<string, References>();
    private generation = 0;
    private request = 0;

    clear(unitId?: string) {
        if (unitId === undefined) this.references.clear();
        else this.references.delete(unitId);
        // An old save must never repopulate a replaced workspace or removed unit.
        this.generation += 1;
    }

    prepare(stickers: SessionSticker[]) {
        const liveIds = new Set(stickers.map((sticker) => sticker.id));
        for (const id of this.references.keys()) {
            if (!liveIds.has(id)) this.references.delete(id);
        }
        const originals = new Map(stickers.map((sticker) => [sticker.id, {
            src: sticker.src,
            previewSrc: sticker.previewSrc,
        }]));
        const managedAssetPaths = new Set<string>();
        return {
            managedAssetPaths,
            generation: this.generation,
            request: ++this.request,
            originals,
            stickers: stickers.map((sticker) => {
                const cached = this.references.get(sticker.id);
                if (!cached) return sticker;
                const next = { ...sticker };
                for (const slot of slots) {
                    const asset = cached[slot];
                    if (asset && sticker[slot] === asset.value) {
                        next[slot] = asset.path;
                        managedAssetPaths.add(asset.path);
                    }
                }
                return next;
            }),
        };
    }

    commit(
        save: ReturnType<SessionAssetReferences["prepare"]>,
        assets: SessionImageAsset[] | undefined,
    ) {
        if (save.generation !== this.generation || save.request !== this.request) return;
        for (const asset of assets ?? []) {
            const original = save.originals.get(asset.id);
            if (!original) continue;
            const cached = this.references.get(asset.id) ?? {};
            for (const slot of slots) {
                const value = original[slot];
                const path = asset[slot];
                if (value?.startsWith("data:image") && path && !path.startsWith("data:")) {
                    cached[slot] = { value, path };
                }
            }
            this.references.set(asset.id, cached);
        }
    }

    async save(
        stickers: SessionSticker[],
        persist: (payload: SessionSticker[], managedPaths: string[]) => Promise<SessionSaveResult>,
    ): Promise<SessionSaveResult> {
        let prepared = this.prepare(stickers);
        let result: SessionSaveResult;
        try {
            result = await persist(prepared.stickers, [...prepared.managedAssetPaths]);
        } catch (error) {
            // A user may remove a managed file. Retry the same revision once with
            // retained pixels; native rejection occurs before the document write.
            if (!String(error).includes("SESSION_ASSET_MISSING") ||
                prepared.generation !== this.generation || prepared.request !== this.request) {
                throw error;
            }
            this.clear();
            prepared = this.prepare(stickers);
            result = await persist(prepared.stickers, [...prepared.managedAssetPaths]);
        }
        this.commit(prepared, result.imageAssets);
        return result;
    }
}

export const sessionAssetReferences = new SessionAssetReferences();
