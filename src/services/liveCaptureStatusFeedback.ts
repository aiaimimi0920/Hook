import type { LiveCaptureStatus } from "./liveCapture";
import { uiActions } from "../store/uiStore";

const messages: Readonly<Record<string, string>> = {
    source_closed: "源窗口已关闭或身份已变化，请重新截图。",
    capture_item_closed: "系统已关闭这个采集源，请检查源窗口后重新截图。",
    capture_unavailable: "无法建立持续采集，请确认目标窗口允许截图后重试。",
    frame_timeout: "源画面长时间没有返回新帧，正在尝试恢复。",
    capture_start_retry: "持续采集暂时中断，正在重新连接源窗口。",
    ipc_poll_failed: "读取实时画面失败，正在重试；请检查 Hook 和源程序是否仍正常运行。",
    frame_handoff_failed: "实时画面交接失败，请缩小选区或关闭部分贴图后重试。",
    frame_encode_failed: "实时画面编码失败，请重新截图。",
    logical_hide_unsupported: "此程序无法在当前隐藏方式下保持渲染，请恢复源窗口后重新截图。",
};

/** One notice per failure episode, even after the notice auto-dismisses. */
export function createLiveCaptureStatusFeedback() {
    const reported = new Map<string, string>();
    return {
        observe(status: LiveCaptureStatus): void {
            if (status.captureState !== "failed" && status.captureState !== "recovering") {
                reported.delete(status.sessionId);
                return;
            }
            const code = status.errorCode && Object.hasOwn(messages, status.errorCode)
                ? status.errorCode : "live_capture_failed";
            const episode = `${status.captureState}:${code}`;
            if (reported.get(status.sessionId) === episode) return;
            reported.set(status.sessionId, episode);
            uiActions.showEnhancementNotice(status.sessionId, {
                feature: "Interaction",
                title: status.captureState === "failed" ? "实时截图已停止更新" : "实时截图正在恢复",
                message: messages[code] ?? "实时采集遇到错误，请检查源程序状态后重新截图。",
                source: { namespace: "core", id: `live-capture:${code}` },
            });
        },
        forget(sessionId: string): void { reported.delete(sessionId); },
        clear(): void { reported.clear(); },
    };
}
