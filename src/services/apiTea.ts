// Owns the Tea ticket command contract; the native bridge owns daemon and HTTP resources.
import { safeInvoke } from "./apiTransport";
import type { TeaHookIntakeRequest, TeaTicketSummary } from "./apiTypes";

export const teaApi = {
    createTeaTicket: (request: TeaHookIntakeRequest): Promise<TeaTicketSummary> =>
        safeInvoke(
            "create_tea_ticket",
            { request },
            () => {
                throw new Error("Tea ticket creation requires the Tauri desktop runtime");
            },
            false,
        ),
};
