// Frontend trigger configuration; Loom and native Live relay own wire validation and framing.
export type LiveObservationConfidence = "exact" | "high" | "medium" | "low";
export interface LiveTriggerCondition {
  conditionId: string;
  revision: number;
  observationId: string;
  operator:
    | "equals"
    | "not_equals"
    | "greater_than"
    | "greater_or_equal"
    | "less_than"
    | "less_or_equal"
    | "contains";
  operand: unknown;
  stableForMs: number;
  risingEdge: boolean;
  rearm: boolean;
  minimumConfidence: LiveObservationConfidence;
}
