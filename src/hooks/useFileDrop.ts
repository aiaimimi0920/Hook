import { onMount, onCleanup } from "solid-js";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { api, isTauriRuntimeAvailable } from "../services/api";

import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";

export function useFileDrop() {
    let unlisten: UnlistenFn | undefined;

    onMount(async () => {
        if (!isTauriRuntimeAvailable()) {
            console.log("Browser preview mode: file-drop listener disabled.");
            return;
        }

        unlisten = await listen("tauri://drag-drop", async (event: any) => {
            console.log("File Drop Event:", event);
            const payload = event.payload;
            if (!payload || !payload.paths || payload.paths.length === 0) return;

            const path = payload.paths[0];
            const position = payload.position;

            // Basic Extension Check
            const lower = path.toLowerCase();
            if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg") && !lower.endsWith(".webp") && !lower.endsWith(".bmp")) {
                 console.log("Dropped file is not a supported image:", path);
                 return;
            }

            try {
                // 1. Read Image
                const base64Src = await api.readImageFromPath(path);


                // 2. Determine Drop Position (Logical Pixels)
                const dpr = window.devicePixelRatio || 1;
                const mx = position.x / dpr;
                const my = position.y / dpr;

                // 3. Hit Test Existing Units (Top-most check)
                const allUnits = graphStore.units;
                let hitUnitId = null;

                for (let i = allUnits.length - 1; i >= 0; i--) {
                    const u = allUnits[i];
                    if (!u.data.minified &&
                        mx >= u.x && mx <= u.x + u.w &&
                        my >= u.y && my <= u.y + u.h) {

                        hitUnitId = u.id;
                        break;
                    }
                }

                if (hitUnitId) {
                    // LOAD FILE INTO PARAMS (Override)
                    // Update previewSrc to verify visual override immediately
                    graphStore.actions.updateUnitData(hitUnitId, {
                        previewSrc: base64Src
                    });

                    // Trigger Sync
                    setTimeout(() => {
                        syncService.performWorkflowSync();
                    }, 50);
                } else {
                    // Create New Sticker
                    const newUnit = {
                        id: crypto.randomUUID(),
                        type: 'sticker' as const,

                        x: mx - 100, // Center roughly
                        y: my - 100,
                        w: 200,
                        h: 200,
                        params: {},
                        inputs: [],
                        outputs: [],
                        data: {
                            src: base64Src,
                            minified: false
                        }
                    };
                    graphStore.actions.addUnit(newUnit);
                    syncService.updateBackendRects();
                }
            } catch (e) {
                console.error("File Drop Failed:", e);
            }
        });
    });

    onCleanup(() => {
        if (unlisten) unlisten();
    });
}
