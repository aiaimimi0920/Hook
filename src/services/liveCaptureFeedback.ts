import { api } from "./api";
import { enhancementNotices, uiActions } from "../store/uiStore";

const messages: Readonly<Record<string, string>> = {
    permission_denied: "无法控制此窗口：目标程序权限高于 Hook，或不属于当前用户。可将两者以同一用户的普通权限重新打开。",
    different_session: "无法控制其他登录会话中的程序。请在当前桌面重新选择目标窗口。",
    secure_desktop: "安全桌面不允许实时贴图交互。返回普通桌面后重新截图。",
    unsupported_region: "此贴图只绑定了屏幕区域，不能操作程序。请在同一程序窗口内部重新框选。",
    source_closed: "源窗口已关闭，请重新截图。",
    source_identity_changed: "源窗口已重建，请重新截图以绑定新窗口。",
    input_delivery_timeout: "源程序没有及时响应，交互已停止。请确认程序未卡住后重新截图。",
    interaction_not_enabled: "此实时贴图尚未启用交互，请重新截图。",
    live_control_failed: "实时贴图交互不可用，请检查源程序状态后重新截图。",
};

/** Reuses the bounded Unit notice stack; never log source titles or input payloads. */
export function showLiveCaptureControlError(unitId: string, reason: string): void {
    const candidate = reason.split(":", 1)[0];
    const code = Object.hasOwn(messages, candidate) ? candidate : "live_control_failed";
    const sourceId = `live-control:${code}`;
    if (enhancementNotices[unitId]?.some((notice) => notice.source?.id === sourceId)) return;
    uiActions.showEnhancementNotice(unitId, {
        feature: "Interaction",
        title: "实时贴图无法交互",
        message: messages[code],
        source: { namespace: "core", id: sourceId },
    });
    void api.debugLogEvent("live-capture-control-unavailable", `session=${unitId} code=${code}`)
        .catch(() => undefined);
}
