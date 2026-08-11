import {
    DECLARATIVE_SURFACE_NODE_TYPES,
    SURFACE_API_VERSION,
    type SurfaceHostCapabilities,
} from "./surfaceProtocol";

export const hookSurfaceHostCapabilities = (): SurfaceHostCapabilities => ({
    apiVersion: SURFACE_API_VERSION,
    runtimes: ["declarative", "javascript"],
    nodes: [...DECLARATIVE_SURFACE_NODE_TYPES],
    transports: ["loom_resource"],
    capabilities: ["remote_resources", "surface.javascript.v1"],
    input: {
        pointer: true,
        hover: true,
        touch: true,
        keyboard: true,
    },
});
