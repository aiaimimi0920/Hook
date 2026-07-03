import { api, type LoomBrainPlanRequest, type LoomBrainPlanResult } from "./api";

export type { LoomBrainPlanRequest, LoomBrainPlanResult };

export interface LoomConnectorApiClient {
    invokeLoomBrainPlan: (request: LoomBrainPlanRequest) => Promise<LoomBrainPlanResult>;
}

export const createLoomConnector = (client: LoomConnectorApiClient) => ({
    brainPlan: (request: LoomBrainPlanRequest): Promise<LoomBrainPlanResult> =>
        client.invokeLoomBrainPlan(request),
});

export const loomConnector = createLoomConnector(api);
