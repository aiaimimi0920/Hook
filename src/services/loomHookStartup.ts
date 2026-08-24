export const refreshLoomHookCapabilitiesOnStartup = async (
    refreshCapabilities: () => Promise<void>,
): Promise<boolean> => {
    await refreshCapabilities();
    return true;
};
