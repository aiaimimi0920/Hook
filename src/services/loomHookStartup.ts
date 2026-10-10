export const refreshLoomHookCapabilitiesOnStartup = async (
    refreshCapabilities: () => Promise<void>,
    enabled = false,
): Promise<boolean> => {
    if (!enabled) return false;
    await refreshCapabilities();
    return true;
};
