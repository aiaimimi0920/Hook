import type { ProjectionSenderBinding } from "./projectionSenderBindings";
import type { ProjectionSyncStatus } from "./qrProjectionSync";
import { projectionError } from "./qrProjectionProtocol";

export interface ProjectionTargetStatus {
    phase: "idle" | "pending" | "success" | "error";
    message: string;
}
export const targetStatus = (phase: ProjectionTargetStatus["phase"], message: string): ProjectionTargetStatus => ({ phase, message });

/** A created invitation is not proof that the receiver displayed the projection. */
export function projectionTargetStatus(binding: ProjectionSenderBinding, sync?: ProjectionSyncStatus): ProjectionTargetStatus {
    if (binding.link.stopPending) return sync?.error
        ? targetStatus("error", `取消失败，后台重试中：${projectionError(sync.error)}`)
        : targetStatus("pending", "正在取消，等待远端确认");
    const error = binding.link.stopReason ?? sync?.error;
    if (binding.link.stopped || error || sync?.delivery?.status === "rejected") {
        return targetStatus("error", `投射失败：${projectionError(error ?? "projection_rejected")}`);
    }
    if (sync?.delivery?.status === "displayed") return targetStatus("success", "投射成功，接收端已显示");
    if (sync?.phase === "syncing") return targetStatus("pending", "正在同步投射");
    return targetStatus("pending", sync?.delivery?.status === "accepted" ? "接收端已接受，等待显示回执" : "邀请已发送，等待接收确认");
}

export function aggregateTargetStatus(states: ProjectionTargetStatus[], unavailable = 0): ProjectionTargetStatus {
    if (unavailable) return targetStatus("error", `${unavailable} 台设备不可用，操作未全部完成`);
    const error = states.find((state) => state.phase === "error");
    if (error) return error;
    const pending = states.find((state) => state.phase === "pending");
    if (pending) return pending;
    if (states.length && states.every((state) => state.phase === "success")) return targetStatus("success", "所有成员操作成功");
    return targetStatus("idle", "尚未操作或仅部分成员已完成");
}
