import { describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import {
  createLoomConnector,
  loomConnector,
  type LoomBrainPlanRequest,
  type LoomBrainPlanResult,
} from "../../src/services/loomConnector";

const brainPlanResult: LoomBrainPlanResult = {
  requestId: "hook-loom-request-1",
  status: "succeeded",
  runId: "run-1",
  summary: "Plan prepared for Hook",
  steps: ["clarify objective", "identify constraints"],
  run: {
    id: "run-1",
    capability: "brain.plan",
    status: "succeeded",
  },
  error: null,
};

describe("loomConnector", () => {
  it("delegates brain planning to an injected API client", async () => {
    const request: LoomBrainPlanRequest = {
      requestId: "hook-loom-request-1",
      goal: "Plan a stable Hook Talk Loom flow",
      constraints: ["keep apps independent"],
      context: { source: "unit-test" },
      timeoutMs: 3000,
    };
    const invokeLoomBrainPlan = vi
      .fn<[LoomBrainPlanRequest], Promise<LoomBrainPlanResult>>()
      .mockResolvedValue(brainPlanResult);

    const connector = createLoomConnector({ invokeLoomBrainPlan });

    await expect(connector.brainPlan(request)).resolves.toBe(brainPlanResult);
    expect(invokeLoomBrainPlan).toHaveBeenCalledWith(request);
  });

  it("uses the Hook API object by default", async () => {
    const request: LoomBrainPlanRequest = {
      goal: "Plan from default Hook API",
    };
    const invokeLoomBrainPlan = vi
      .spyOn(api, "invokeLoomBrainPlan")
      .mockResolvedValue(brainPlanResult);

    try {
      await expect(loomConnector.brainPlan(request)).resolves.toBe(brainPlanResult);
      expect(invokeLoomBrainPlan).toHaveBeenCalledWith(request);
    } finally {
      invokeLoomBrainPlan.mockRestore();
    }
  });
});
