export const refreshLoomHookCapabilitiesOnStartup = async (
    loomHookEnabled: boolean,
    refreshCapabilities: () => Promise<void>,
): Promise<boolean> => {
    if (!loomHookEnabled) {
        return false;
    }

    await refreshCapabilities();
    return true;
};
