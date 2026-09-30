import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { ProjectionSyncStatus } from "../services/qrProjectionSync";

export type ProjectionShareAction = "qr" | "link" | "targets";
export type ProjectionImportKind = "qr" | "link" | "combined";
export interface ProjectionDialogTarget { unitId?: string; anchorUnitId?: string; invitationText?: string; shareAction?: ProjectionShareAction; importKind?: ProjectionImportKind }
export const [projectionDialog, setProjectionDialog] = createSignal<ProjectionDialogTarget>();
const [projectionStatuses, setStatuses] = createStore<Record<string, ProjectionSyncStatus | undefined>>({});
export { projectionStatuses };
// Sync reports are complete snapshots; recovered errors and old delivery receipts must not survive a new phase.
export const setProjectionStatuses = (id: string, status: ProjectionSyncStatus | undefined) => setStatuses(id, reconcile(status));
export const openProjection = (unitId: string, shareAction?: ProjectionShareAction) => setProjectionDialog({ unitId, ...(shareAction ? { shareAction } : {}) });
export const openProjectionReceiver = (invitationText = "", importKind?: ProjectionImportKind, anchorUnitId?: string) =>
    setProjectionDialog({ invitationText, ...(importKind ? { importKind } : {}), ...(anchorUnitId ? { anchorUnitId } : {}) });
export const closeProjectionDialog = () => setProjectionDialog(undefined);

export const projectionStatusLabel = (status: ProjectionSyncStatus | undefined): string => status?.phase === "connected" && status.delivery
    ? status.delivery.status === "displayed" ? "接收端已显示 · 自动同步" : "接收端已接受 · 等待显示回执"
    : status?.phase === "connected" && status.transport
    ? `${status.transport === "direct" ? "直连" : "加密中继"} · 自动同步`
    : ({
    waiting: "等待另一台设备接收", connected: "已连接 · 自动同步", syncing: "正在同步图像",
    retrying: "连接中断 · 正在重试", stopping: "本机已停止 · 等待通知远端", stopped: "投射已停止",
}[status?.phase ?? "waiting"]);
