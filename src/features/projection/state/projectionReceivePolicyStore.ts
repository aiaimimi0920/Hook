import { createSignal } from "solid-js";

/** Device-wide consent for NEW pushes; accepted bindings keep their existing lifetime. */
export type ProjectionReceivePolicy = "auto" | "confirm" | "reject";
const key = "otter.projection-receive-policy.v1";
export const isProjectionReceivePolicy = (value: unknown): value is ProjectionReceivePolicy =>
    value === "auto" || value === "confirm" || value === "reject";

function load(): ProjectionReceivePolicy {
    try {
        const saved = localStorage.getItem(key);
        if (saved === null) return "confirm";
        const value: unknown = JSON.parse(saved);
        if (value && typeof value === "object" && "version" in value && value.version === 1
            && "policy" in value && isProjectionReceivePolicy(value.policy)) return value.policy;
    } catch { /* Unreadable consent must never enable automatic acceptance. */ }
    return "reject";
}

const [policy, updatePolicy] = createSignal<ProjectionReceivePolicy>(load());
export { policy as projectionReceivePolicy };
let revision = 0;
export const projectionReceivePolicyRevision = () => revision;
export function saveProjectionReceivePolicy(next: ProjectionReceivePolicy): void {
    if (!isProjectionReceivePolicy(next)) throw new Error("接收投射策略无效");
    localStorage.setItem(key, JSON.stringify({ version: 1, policy: next }));
    if (next !== policy()) {
        revision += 1; // Reject late acceptance even when the user changes away and back.
        updatePolicy(next);
    }
}
