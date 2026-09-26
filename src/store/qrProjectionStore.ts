import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { ProjectionSyncStatus } from "../services/qrProjectionSync";

export interface ProjectionDialogTarget { unitId?: string; invitationText?: string }
export const [projectionDialog, setProjectionDialog] = createSignal<ProjectionDialogTarget>();
export const [projectionStatuses, setProjectionStatuses] = createStore<Record<string, ProjectionSyncStatus | undefined>>({});
export const openProjection = (unitId: string) => setProjectionDialog({ unitId });
export const openProjectionReceiver = (invitationText = "") => setProjectionDialog({ invitationText });
export const closeProjectionDialog = () => setProjectionDialog(undefined);

export const projectionStatusLabel = (status: ProjectionSyncStatus | undefined): string => status?.phase === "connected" && status.transport
    ? `${status.transport === "direct" ? "直连" : "加密中继"} · 自动同步`
    : ({
    waiting: "等待另一台设备接收", connected: "已连接 · 自动同步", syncing: "正在同步图像",
    retrying: "连接中断 · 正在重试", stopping: "本机已停止 · 等待通知远端", stopped: "投射已停止",
}[status?.phase ?? "waiting"]);
