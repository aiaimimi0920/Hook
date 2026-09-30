// Keeps external navigation behind Hook's native, fail-closed HTTPS broker.
import { safeInvoke } from "./apiTransport";

export const externalUrlApi = {
    openExternalHttpsUrl: (url: string): Promise<void> =>
        safeInvoke<void>("open_external_https_url", { url }),
};
