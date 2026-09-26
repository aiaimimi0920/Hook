import type { ProjectionEnvelope, ProjectionResponse, ProjectionSnapshot, QrProjectionLink } from "../types/qrProjection";

export const PROJECTION_PROTOCOL = "neuro.qr-projection.v1";
export const PROJECTION_PROTOCOL_V2 = "neuro.qr-projection.v2";
export const MAX_PROJECTION_IMAGE_BYTES = 4 * 1024 * 1024;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:/-]{1,160}$/.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));

export function projectionOrigin(value: string): string {
    if (value.length > 256 || /[^\x21-\x7e]|[\\%@]/.test(value)) throw new Error("projection_invalid_origin");
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
        || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.port === "0") {
        throw new Error("projection_invalid_origin");
    }
    return url.origin;
}

export const isProjectionLoopback = (origin: string) => {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "[::1]" || /^127\./.test(host);
};

export function parseProjectionEnvelope(value: unknown): ProjectionEnvelope {
    const v2 = record(value) && value.protocol === PROJECTION_PROTOCOL_V2;
    if (!record(value) || !keys(value, ["protocol", "projectionId", "serverOrigin", "source", "content", "expiresAtMs", "nonce", "signature"])
        || (!v2 && value.protocol !== PROJECTION_PROTOCOL) || typeof value.projectionId !== "string" || !/^projection:[a-fA-F0-9]{32}$/.test(value.projectionId)
        || typeof value.serverOrigin !== "string" || projectionOrigin(value.serverOrigin) !== value.serverOrigin
        || !record(value.source) || !keys(value.source, ["deviceId", "sessionId", "unitId", "revision", ...(v2 ? ["accountId", "publicKey"] : [])])
        || !identifier(value.source.deviceId) || !identifier(value.source.sessionId) || !identifier(value.source.unitId) || !revision(value.source.revision)
        || (v2 && (!identifier(value.source.accountId) || typeof value.source.publicKey !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value.source.publicKey)))
        || !record(value.content) || !keys(value.content, ["kind", "digest"]) || !["sticker", "art"].includes(String(value.content.kind)) || !digest(value.content.digest)
        || !revision(value.expiresAtMs) || typeof value.nonce !== "string" || !/^[a-fA-F0-9]{32}$/.test(value.nonce)
        || !record(value.signature) || !keys(value.signature, ["algorithm", "keyId", "value"]) || value.signature.algorithm !== "ed25519"
        || value.signature.keyId !== value.source.deviceId || typeof value.signature.value !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(value.signature.value)) {
        throw new Error("projection_invalid_invitation");
    }
    return value as unknown as ProjectionEnvelope;
}

export function parseProjectionInvitation(text: string): ProjectionEnvelope {
    if (text.length > 4096) throw new Error("projection_invalid_invitation");
    try { return parseProjectionEnvelope(JSON.parse(text)); }
    catch { throw new Error("projection_invalid_invitation"); }
}

export function parseProjectionResponse(value: unknown): ProjectionResponse {
    if (!record(value) || value.offlineTransport !== undefined) throw new Error("projection_invalid_response");
    const envelope = parseProjectionEnvelope(value.envelope);
    if (!revision(value.revision) || value.revision < envelope.source.revision || !digest(value.digest) || typeof value.linked !== "boolean"
        || (value.receiverDeviceId !== null && !identifier(value.receiverDeviceId))
        || (value.receiverUnitId !== null && !identifier(value.receiverUnitId))) throw new Error("projection_invalid_response");
    if (value.snapshot != null) parseProjectionSnapshot(value.snapshot);
    if (value.delivery != null && (!record(value.delivery) || !identifier(value.delivery.targetDeviceId)
        || !["awaiting_confirmation", "accepted", "displayed", "rejected"].includes(String(value.delivery.status)))) throw new Error("projection_invalid_response");
    if (value.transport != null && !["direct", "relay", "offline", "reconnecting"].includes(String(value.transport))) throw new Error("projection_invalid_response");
    return { ...value, envelope } as unknown as ProjectionResponse;
}

export function parseProjectionSnapshot(value: unknown): ProjectionSnapshot {
    if (!record(value) || !revision(value.width) || !revision(value.height) || value.width > 8192 || value.height > 8192
        || value.width * value.height > 16_777_216 || typeof value.imageBase64 !== "string"
        || value.imageBase64.length > Math.ceil(MAX_PROJECTION_IMAGE_BYTES / 3) * 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64)) throw new Error("projection_invalid_image");
    return value as unknown as ProjectionSnapshot;
}

export function parseOfflineTransport(value: unknown): { origin: string } {
    if (!record(value) || typeof value.origin !== "string") throw new Error("projection_invalid_origin");
    return { origin: projectionOrigin(value.origin) };
}

export function sanitizeProjectionLink(value: unknown, unitId: string): QrProjectionLink | undefined {
    try {
        if (!record(value) || !["source", "receiver"].includes(String(value.role)) || value.localUnitId !== unitId
            || !revision(value.revision) || !digest(value.digest) || typeof value.linked !== "boolean") return undefined;
        const envelope = parseProjectionEnvelope(value.envelope);
        if (value.role === "source" && envelope.source.unitId !== unitId) return undefined;
        const offlineTransport = value.offlineTransport === undefined ? undefined : parseOfflineTransport(value.offlineTransport);
        if (offlineTransport && envelope.protocol !== "neuro.qr-projection.v1") return undefined;
        return { role: value.role as QrProjectionLink["role"], localUnitId: unitId, envelope,
            ...(offlineTransport ? { offlineTransport } : {}),
            revision: value.revision, digest: value.digest, linked: value.linked, stopPending: value.stopPending === true,
            stopped: value.stopped === true,
            stopReason: typeof value.stopReason === "string" && /^projection_[a-z_]{1,50}$/.test(value.stopReason) ? value.stopReason : undefined };
    } catch { return undefined; }
}

export const projectionError = (error: unknown): string => {
    const code = error instanceof Error ? error.message : String(error);
    const messages: Record<string, string> = {
        projection_pairing_required: "请在目标 Loom 的设备管理中批准本机，然后重试。",
        projection_target_offline: "接收设备已离线或关闭投送，请刷新设备列表。",
        projection_target_unavailable: "接收设备不可用，请检查设备配对。",
        projection_rejected: "接收端已拒绝此次投送。",
        projection_display_pending: "已接受，正在等待本机图像显示。",
        projection_workspace_changed: "工作区已切换，请重新保存接收设置以恢复设备投送。",
        projection_invalid_invitation: "邀请内容无效，请重新读取投射二维码。",
        projection_invalid_origin: "请输入有效的 HTTPS 服务地址。",
        projection_invitation_expired: "二维码已过期，请在发送端重新生成。",
        projection_invitation_consumed: "此二维码已被接收，请使用新的邀请。",
        projection_content_changed: "发送内容已经更新，请重新查看后确认。",
        projection_loom_unavailable: "请先启动 Loom，或填写两端可达的 HTTPS 地址。",
        projection_image_budget: "图像超过投射限制，请缩小图像后重试。",
        projection_no_image: "此图块尚无可投射的正式图像。",
        projection_live_unsupported: "实时采集请使用屏幕墙发布；二维码投射用于正式图像。",
        projection_source_revoked: "发送设备的授权已撤销，投射已停止。",
        projection_peer_revoked: "Loom 互信配置已变更，投送已停止，请重新发起。",
        projection_unlinked: "投射已停止，保留最后收到的内容。",
        projection_source_limit: "已达到本机投射数量上限，请停止已有投射。",
        projection_same_device: "请在另一台设备上接收此投射。",
        projection_cleanup_limit: "待清理的投射过多，请恢复网络后重试。",
        account_signed_out: "请前往本机 Loom 登录账号，然后刷新登录状态。",
        account_identity_invalid: "Loom 登录已失效，请前往 Loom 重新登录。",
        device_session_unavailable: "Loom 账号会话已失效，请前往 Loom 重新登录。",
        projection_account_mismatch: "此关联属于原来的 Loom 账号或设备，请恢复原身份或重新创建邀请。",
        projection_local_loom_required: "账号投射需要连接本机 Loom，请检查 Loom 本机服务设置。",
        projection_peer_unavailable: "对端暂时离线，Loom 将在恢复连接后同步最新图像。",
        projection_not_configured: "当前账号服务尚未配置投射网络，请联系服务管理员。",
    };
    return messages[code] ?? "连接暂时不可用，请检查网络和设备配对后重试。";
};
