let mountedSurfaceInstances = 0;

export const registerExtensionSurfaceInstance = (): (() => void) => {
    mountedSurfaceInstances += 1;
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        mountedSurfaceInstances = Math.max(0, mountedSurfaceInstances - 1);
    };
};

export const extensionSurfaceDiagnostics = () => ({
    mountedInstances: mountedSurfaceInstances,
});
