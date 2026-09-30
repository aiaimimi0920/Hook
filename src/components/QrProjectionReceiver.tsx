import { createSignal, For, onCleanup, Show } from "solid-js";
import type { ProjectionEnvelope, ProjectionResponse } from "../types/qrProjection";
import { graphStore } from "../store/graphStore";
import { closeProjectionDialog, type ProjectionImportKind } from "../store/qrProjectionStore";
import { requestProjection } from "../services/qrProjectionApi";
import { queueProjectionUnlink } from "../services/qrProjectionCleanup";
import { recognizedProjectionInvitations } from "../services/qrProjectionInvitations";
import { projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { isProjectionLoopback, parseProjectionInvitation, projectionError } from "../services/qrProjectionProtocol";
import { attachProjectionReceiver } from "../services/qrProjectionSession";
import { ProjectionReceiveSettings } from "./ProjectionReceiveSettings";
import { ProjectionQrFileInput } from "./ProjectionQrFileInput";
import { MAX_PROJECTION_INVITATION_TEXT } from "../services/projectionInvitationLink";

export const QrProjectionReceiver = (props: { initialText: string; importKind?: ProjectionImportKind }) => {
    const combined = () => props.importKind === "combined";
    const [method, setMethod] = createSignal<"qr" | "link">("qr");
    const inputKind = () => combined() ? method() : props.importKind;
    const [text, setText] = createSignal(props.initialText);
    const [envelope, setEnvelope] = createSignal<ProjectionEnvelope>();
    const [preview, setPreview] = createSignal<ProjectionResponse>();
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [acceptanceStarted, setAcceptanceStarted] = createSignal(false);
    const receiverUnitId = crypto.randomUUID();
    const generation = projectionWorkspaceGeneration();
    let alive = true;
    let attached = false;
    const valid = () => alive && projectionWorkspaceGeneration() === generation;
    const cleanupAttempt = () => {
        const invitation = envelope();
        if (acceptanceStarted() && !attached && invitation) {
            queueProjectionUnlink(invitation);
        }
    };
    onCleanup(() => { alive = false; cleanupAttempt(); });
    const parse = (value = text()) => {
        if (busy() || acceptanceStarted()) return;
        setError(""); setPreview(undefined); setEnvelope(undefined);
        try { setEnvelope(parseProjectionInvitation(value.trim())); }
        catch (reason) { setError(projectionError(reason)); }
    };
    const inspect = async () => {
        const invitation = envelope();
        if (!invitation || busy() || !valid()) return;
        setBusy(true); setError("");
        try {
            const response = await requestProjection({ kind: "inspect", envelope: invitation });
            if (valid()) { setPreview(response); return response; }
        } catch (reason) { if (valid()) setError(projectionError(reason)); }
        finally { if (alive) setBusy(false); }
    };
    const accept = async (inspected = preview()) => {
        const invitation = envelope();
        if (!invitation || !inspected || busy() || !valid()) return;
        setBusy(true); setError(""); setAcceptanceStarted(true);
        try {
            const response = await requestProjection({ kind: "accept", envelope: invitation, expectedRevision: inspected.revision,
                expectedDigest: inspected.digest, receiverUnitId, confirmed: true });
            if (!valid()) { cleanupAttempt(); return; }
            attachProjectionReceiver(receiverUnitId, response);
            attached = true;
            closeProjectionDialog();
        } catch (reason) {
            if (valid()) setError(projectionError(reason)); else cleanupAttempt();
        } finally { if (alive) setBusy(false); }
    };
    const importContent = async () => {
        if (busy() || !valid()) return;
        // One explicit confirmation still inspects the current revision before accepting it.
        const inspected = await inspect();
        if (inspected && valid()) await accept(inspected);
    };
    return <>
        <Show when={!props.importKind}><ProjectionReceiveSettings /></Show>
        <Show when={combined()}>
            <div class="flex flex-wrap gap-2" role="group" aria-label="投射导入方式">
                <For each={["qr", "link"] as const}>{(kind) => <button type="button" class="hook-terminal-btn"
                    aria-pressed={method() === kind} disabled={busy() || acceptanceStarted()}
                    onClick={() => {
                        if (method() === kind) return;
                        setMethod(kind); setText(""); setEnvelope(undefined); setPreview(undefined); setError("");
                    }}>{kind === "qr" ? "二维码图片" : "投射链接"}</button>}</For>
            </div>
        </Show>
        <Show when={inputKind() !== "link"}><ProjectionQrFileInput compact={combined()} disabled={busy() || acceptanceStarted()}
            preparing={() => { setText(""); setEnvelope(undefined); setPreview(undefined); setError(""); }}
            imported={(value) => { setText(value); parse(value); }} /></Show>
        <Show when={!combined()}>
        <p>导入后确认来源，即可在本机创建关联贴图。</p>
        </Show>
        <Show when={!combined() || inputKind() === "link"}>
        <label class="qr-projection-field"><Show when={!combined()}>{inputKind() === "link" ? "投射链接" : "邀请内容"}</Show>
            <textarea rows={combined() ? 2 : 4} value={text()} aria-label={inputKind() === "link" ? "投射链接" : "邀请内容"}
                placeholder={combined() ? "粘贴链接" : undefined} maxLength={MAX_PROJECTION_INVITATION_TEXT} disabled={busy() || acceptanceStarted()} spellcheck={false}
                onInput={(event) => {
                    const value = event.currentTarget.value;
                    setText(value); setEnvelope(undefined); setPreview(undefined); setError("");
                    if (combined() && value.trim()) parse(value);
                }} />
        </label>
        </Show>
        <Show when={!combined() && !acceptanceStarted()}><button type="button" class="hook-terminal-btn" disabled={busy() || !text().trim()} onClick={() => parse()}>读取邀请</button></Show>
        <Show when={!combined() && !envelope() && inputKind() !== "link"}>
            <For each={recognizedProjectionInvitations(graphStore.units)}>{(invitation, index) =>
                <button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => { setText(invitation); parse(invitation); }}>
                    使用已识别的投射二维码 {index() + 1}</button>}
            </For>
            <p>可先截取二维码并运行二维码识别，再从这里选择识别结果。</p>
        </Show>
        <Show when={envelope()}>{(invitation) => <>
            <Show when={combined()} fallback={<div class="qr-projection-address"><span>{invitation().protocol === "neuro.qr-projection.v2" ? "Loom 账号服务" : "将连接到此服务器"}</span><strong>{invitation().serverOrigin}</strong></div>}>
                <span class="truncate text-xs text-[var(--theme-text-muted)]" aria-label="投射来源地址" title={invitation().serverOrigin}>{invitation().serverOrigin}</span>
            </Show>
            <Show when={invitation().protocol === "neuro.qr-projection.v1" && isProjectionLoopback(invitation().serverOrigin)}><p class="qr-projection-warning">这是本机地址，不能连接另一台电脑。请让发送端使用双方可达的 HTTPS 地址。</p></Show>
            <Show when={!combined()}><p>{invitation().protocol === "neuro.qr-projection.v2"
                ? "请先在本机 Loom 登录与发送端相同的账号。确认后由本机 Loom 校验邀请并读取图像，无需在 Hook 再次登录。"
                : "确认地址后，Hook 将使用本机设备身份连接。首次连接需要在该 Loom 的设备管理中批准本机。"}</p></Show>
            <Show when={!combined()}><button type="button" class="hook-terminal-btn" disabled={busy()} onClick={() => void inspect()}>
                {busy() ? "正在连接…" : preview() ? "重新查看最新内容" : "确认地址并查看内容"}</button></Show>
        </>}</Show>
        <Show when={!combined() && preview()}>{(inspected) => <>
            <dl class="qr-projection-details">
                <div><dt>来源设备</dt><dd>{inspected().sourceName || inspected().envelope.source.deviceId}</dd></div>
                <div><dt>内容类型</dt><dd>{inspected().envelope.content.kind === "art" ? "Art 正式图像" : "贴图"}</dd></div>
                <div><dt>图像版本</dt><dd>{inspected().revision}</dd></div>
            </dl>
            <Show when={inspected().snapshot}>{(snapshot) => <img class="qr-projection-preview" src={`data:image/png;base64,${snapshot().imageBase64}`} alt="即将接收的投射图像" />}</Show>
            <button type="button" class="hook-terminal-btn hook-terminal-btn--active" disabled={busy()} onClick={() => void accept()}>
                {busy() ? "正在创建关联贴图…" : "接收为关联贴图"}</button>
        </>}</Show>
        <Show when={combined()}><button type="button" class="hook-terminal-btn hook-terminal-btn--active"
            disabled={busy() || !envelope()} onClick={() => void importContent()}>{busy() ? "正在导入…" : "导入"}</button></Show>
        <Show when={error()}><p role="alert" class="qr-projection-warning">{error()}</p></Show>
    </>;
};
