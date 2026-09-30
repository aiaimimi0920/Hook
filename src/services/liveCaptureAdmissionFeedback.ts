import { showUnitFailureNotice } from "./unitFailureNotice";

const messages: Readonly<Record<string, string>> = {
    live_resource_memory_pressure: "可用内存不足以安全增加这张实时贴图。请缩小选区或关闭部分贴图后重试。",
    live_resource_gpu_pressure: "新增采集预计会超出当前显存预算。请缩小源窗口或关闭部分贴图后重试。",
    live_resource_cpu_pressure: "当前系统负载或新增采集的预计开销过高。已有贴图保留，请稍后重试。",
    live_resource_cooldown: "系统正在负载保护期，已有贴图已降低采集频率。负载稳定后可重新创建。",
    live_resource_telemetry_unavailable: "无法读取系统资源余量，暂不启动新的实时采集。请稍后重试。",
    live_resource_hard_limit: "已达到当前版本的 16 路安全上限。实际可用数量还会根据资源消耗动态调整。",
    "live capture session limit reached": "已达到当前版本的 16 路安全上限，请关闭不再使用的实时贴图。",
};

export function liveCaptureAdmissionMessage(error: unknown): string | undefined {
    const code = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return Object.hasOwn(messages, code) ? messages[code] : undefined;
}

/** Called after capture-input cleanup; use the existing interactive Unit notice host. */
export function showLiveCaptureAdmissionError(error: unknown, unitId?: string): void {
    if (error === undefined) return;
    const message = liveCaptureAdmissionMessage(error)
        ?? "实时截图启动失败。请确认源窗口仍然打开、选区有效，并尝试重新截图。未知错误的原始详情不会直接显示，以免泄露页面内容。";
    showUnitFailureNotice({ feature: "Interaction", title: "实时截图启动失败", message,
        source: { namespace: "core", id: "live-capture-admission" } }, unitId);
}
