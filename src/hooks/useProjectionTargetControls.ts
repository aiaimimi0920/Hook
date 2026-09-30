import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";
import type { QrProjectionLink } from "../types/qrProjection";
import { graphStore } from "../store/graphStore";
import { projectionStatuses } from "../store/qrProjectionStore";
import { projectionContext, unlinkProjection } from "../services/qrProjectionApi";
import { deliveryTargets, type DeliveryDirectory, type DeliveryTarget } from "../services/projectionDeliveryApi";
import { deliveryTargetIdentity, sendProjectionBatch } from "../services/projectionBatchSend";
import { projectionBindingKey, projectionBindingStatusKey, projectionTargetKey, type ProjectionSenderBinding } from "../services/projectionSenderBindings";
import { patchProjection, saveProjectionSenders } from "../services/qrProjectionSession";
import { cancelPreparedCreate, loadPreparedCreate, preparedCreateKey } from "../services/projectionCreateJournal";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";
import { projectionError } from "../services/qrProjectionProtocol";
import { aggregateTargetStatus, projectionTargetStatus, targetStatus, type ProjectionTargetStatus } from "../services/projectionTargetStatus";

interface Device {
    key: string; id: string; title: string; origin: string;
    identity: ProjectionSenderBinding["target"]; target?: DeliveryTarget;
}
interface Operation {
    device: Device; enabled: boolean; phase: "sending" | "stopping" | "settled" | "error";
    error?: string; stopKey?: string; stopLink?: QrProjectionLink;
}
export interface ProjectionTargetRow {
    key: string; id: string; title: string; checked: boolean; mixed?: boolean; disabled: boolean;
    status: ProjectionTargetStatus; change: (enabled: boolean) => void; retry?: () => void;
}
const bindingOrigin = (binding: ProjectionSenderBinding) => binding.link.offlineTransport?.origin ?? binding.link.envelope.serverOrigin;
const gone = new Set(["projection_unlinked", "projection_not_found", "projection_invitation_expired"]);

/** Checkbox intent stays distinct from remote completion; saved bindings own durable stop/retry. */
export function useProjectionTargetControls(props: { unitId: string }) {
    const id = untrack(() => props.unitId);
    const generation = projectionWorkspaceGeneration();
    let alive = true;
    onCleanup(onProjectionUnitRemoved((removed) => { if (removed === id) alive = false; }));
    onCleanup(() => { alive = false; });
    const unit = () => alive && generation === projectionWorkspaceGeneration() && props.unitId === id
        ? graphStore.units.find((item) => item.id === id) : undefined;
    const [origin, setOrigin] = createSignal("");
    const [directory, setDirectory] = createSignal<DeliveryDirectory>({ targets: [], groups: [], status: "complete" });
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [operations, setOperations] = createSignal<Record<string, Operation>>({});
    const [groupIntents, setGroupIntents] = createSignal<Record<string, boolean>>({});
    const bindings = () => unit()?.data.projectionSenders ?? [];
    const bindingFor = (key: string) => bindings().find((binding) => projectionTargetKey(bindingOrigin(binding), binding.target) === key);
    const statusFor = (binding: ProjectionSenderBinding) => projectionStatuses[projectionBindingStatusKey(id, projectionBindingKey(binding.link))];
    const fromTarget = (target: DeliveryTarget, server = origin()): Device => ({
        key: projectionTargetKey(server, deliveryTargetIdentity(target)), id: target.deviceId, origin: server,
        identity: deliveryTargetIdentity(target), target,
        title: target.name + (target.route === "offline_peer" ? ` · ${target.peerName}` : ""),
    });
    const remember = (operation: Operation) => setOperations((previous) => {
        const entries = Object.entries(previous).filter(([key, value]) => key !== operation.device.key
            && !(value.phase === "settled" && !bindingFor(key) && Object.keys(previous).length >= 96));
        return { ...Object.fromEntries(entries), [operation.device.key]: operation };
    });
    const devices = () => {
        const result = new Map(origin() ? directory().targets.map((target) => {
            const device = fromTarget(target); return [device.key, device] as const;
        }) : []);
        // Previously saved targets remain cancellable when discovery or the current Loom is unavailable.
        for (const binding of bindings()) {
            const server = bindingOrigin(binding);
            const key = projectionTargetKey(server, binding.target);
            if (!result.has(key)) result.set(key, {
                key, id: binding.target.deviceId, identity: binding.target, origin: server,
                title: `${binding.target.name} · ${server}${binding.target.peerId ? ` · ${binding.target.peerId}` : ""}`,
            });
        }
        for (const operation of Object.values(operations())) if (!result.has(operation.device.key)) result.set(operation.device.key, operation.device);
        return [...result.values()];
    };
    const state = (device: Device) => {
        const binding = bindingFor(device.key), operation = operations()[device.key];
        const checked = operation?.phase === "sending" || operation?.phase === "error" ? operation.enabled : !!binding && !binding.link.stopPending;
        let status = targetStatus("idle", "尚未投射");
        if (operation?.phase === "error") status = targetStatus("error", operation.error!);
        else if (operation?.phase === "sending") status = targetStatus("pending", "正在投射");
        else if (binding) status = projectionTargetStatus(binding, statusFor(binding));
        else if (operation?.phase === "stopping") status = targetStatus("pending", "正在取消，等待远端确认");
        else if (operation?.phase === "settled" && !operation.enabled) status = targetStatus("success", "取消投射成功");
        const stopping = operation?.phase === "stopping" || !!binding?.link.stopPending;
        return { checked, status, stopping };
    };

    createEffect(() => {
        for (const binding of bindings()) {
            const key = projectionTargetKey(bindingOrigin(binding), binding.target);
            if (binding.link.stopPending && !operations()[key]?.stopKey) {
                const device = devices().find((item) => item.key === key)!;
                remember({ device, enabled: false, phase: "stopping",
                    stopKey: projectionBindingStatusKey(id, projectionBindingKey(binding.link)), stopLink: binding.link });
            }
        }
        for (const operation of Object.values(operations())) {
            if (operation.phase !== "stopping" || !operation.stopKey || !unit()) continue;
            const sync = projectionStatuses[operation.stopKey];
            if (sync?.phase === "stopped" && !bindingFor(operation.device.key)) remember({
                ...operation, phase: sync.error && !gone.has(sync.error) ? "error" : "settled",
                error: sync.error && !gone.has(sync.error) ? `取消失败：${projectionError(sync.error)}` : undefined,
            });
        }
    });

    const refresh = async () => {
        if (busy() || !unit()) return;
        setBusy(true); setError("");
        try {
            const server = await projectionContext();
            const fresh = await deliveryTargets(server);
            if (unit()) {
                if (origin() !== server) setGroupIntents({});
                setOrigin(server); setDirectory(fresh);
            }
        } catch (reason) { if (unit()) setError(projectionError(reason)); }
        finally { if (alive) setBusy(false); }
    };
    onMount(() => { void refresh(); });

    const stop = async (device: Device) => {
        const binding = bindingFor(device.key);
        if (binding) {
            const key = projectionBindingKey(binding.link);
            remember({ device, enabled: false, phase: "stopping", stopKey: projectionBindingStatusKey(id, key), stopLink: binding.link });
            patchProjection(id, { ...binding.link, stopped: false, stopReason: undefined, stopPending: true }, undefined, key);
            return;
        }
        const previous = operations()[device.key]?.stopLink;
        if (previous) {
            // A terminal sync error can detach the local binding without proving remote cancellation.
            await unlinkProjection(previous.envelope.projectionId, previous.envelope.serverOrigin,
                previous.envelope.protocol, ...(previous.offlineTransport ? [previous.offlineTransport] as const : []));
            if (unit()) remember({ device, enabled: false, phase: "settled" });
            return;
        }
        const peer = device.identity.peerId ? { peerId: device.identity.peerId, remoteDeviceId: device.identity.deviceId } : undefined;
        const key = preparedCreateKey(device.origin, id, device.id, peer);
        const prepared = await loadPreparedCreate(key);
        if (!unit()) return;
        if (prepared) {
            // Cancel the durable create before unlinking an uncertain/failed creation.
            await cancelPreparedCreate(key);
            await unlinkProjection(prepared.envelope.projectionId, prepared.envelope.serverOrigin,
                prepared.envelope.protocol, ...(prepared.target ? [{ origin: prepared.origin }] as const : []));
        }
        if (unit()) remember({ device, enabled: false, phase: "settled" });
    };

    const change = async (requested: Device[], enabled: boolean, groupId?: string) => {
        if (busy() || !unit() || unit()?.data.qrProjection?.role === "receiver" || requested.some((device) => state(device).stopping)) return;
        if (Object.keys(operations()).length + requested.filter((device) => !operations()[device.key]).length > 128) {
            setError("操作记录已满，请关闭并重新打开投射工具栏。"); return;
        }
        setBusy(true); setError("");
        if (groupId) setGroupIntents((previous) => ({ ...previous, [groupId]: enabled }));
        let affected = enabled ? requested : requested.filter((device) => {
            const previous = operations()[device.key];
            return bindingFor(device.key) || previous?.phase !== "settled" || previous.enabled;
        });
        for (const device of affected) remember({ device, enabled, phase: enabled ? "sending" : "stopping",
            ...(!enabled ? { stopLink: operations()[device.key]?.stopLink } : {}) });
        try {
            if (enabled) {
                const server = await projectionContext();
                if (!unit()) return;
                if (requested.some((device) => device.origin !== server)) throw new Error("projection_context_changed");
                const fresh = await deliveryTargets(server);
                if (!unit()) return;
                setOrigin(server); setDirectory(fresh);
                const wanted = groupId ? fresh.groups?.find((group) => group.groupId === groupId)?.targetIds : requested.map((device) => device.id);
                const targets = fresh.targets.filter((target) => wanted?.includes(target.deviceId));
                if (!targets.length) throw new Error("projection_target_unavailable");
                for (const device of requested.filter((device) => !targets.some((target) => fromTarget(target, server).key === device.key))) {
                    remember({ device, enabled, phase: "error", error: "投射失败：目标已不可用" });
                }
                const next = targets.map((target) => fromTarget(target, server));
                if (Object.keys(operations()).length + next.filter((device) => !operations()[device.key]).length > 128) {
                    throw new Error("projection_source_limit");
                }
                affected = next;
                for (const device of affected) remember({ device, enabled, phase: "sending" });
                const sendable = affected.filter((device) => {
                    if (!bindingFor(device.key)?.link.stopped) return true;
                    remember({ device, enabled, phase: "error", error: "投射已停止，请先取消旧关联再重新开启" }); return false;
                });
                await sendProjectionBatch(server, sendable.map((device) => device.target!), {
                    current: unit, save: (next) => saveProjectionSenders(id, next),
                    result: (result) => {
                        if (!unit()) return;
                        remember({ device: fromTarget(result.target, server), enabled, phase: result.error ? "error" : "settled",
                            error: result.error ? `投射失败：${projectionError(result.error)}` : undefined });
                    },
                });
            } else {
                for (const device of affected) {
                    if (!unit()) return;
                    try { await stop(device); }
                    catch (reason) { if (unit()) remember({ ...operations()[device.key], device, enabled, phase: "error",
                        error: `取消失败：${projectionError(reason)}` }); }
                }
            }
        } catch (reason) {
            if (unit()) for (const device of affected) remember({ device, enabled, phase: "error",
                error: `${enabled ? "投射" : "取消"}失败：${projectionError(reason)}` });
        } finally { if (alive) setBusy(false); }
    };
    const deviceRow = (device: Device): ProjectionTargetRow => {
        const current = state(device);
        const unavailable = !device.target || (device.target.route === "offline_peer" && !device.target.deliveryAvailable);
        return { key: device.key, id: device.id, title: device.title, checked: current.checked, status: current.status,
            disabled: busy() || !unit() || unit()?.data.qrProjection?.role === "receiver" || current.stopping || (unavailable && !current.checked),
            change: (enabled) => { void change([device], enabled); },
            ...(current.status.phase === "error" && !current.stopping ? { retry: () => { void change([device], operations()[device.key]?.enabled ?? current.checked); } } : {}),
        };
    };
    const rows = (kind: "devices" | "groups"): ProjectionTargetRow[] => kind === "devices" ? devices().map(deviceRow)
        : (directory().groups ?? []).map((group) => {
            const members = devices().filter((device) => device.origin === origin() && device.target && group.targetIds.includes(device.target.deviceId));
            const states = members.map(state), checked = states.filter((item) => item.checked).length;
            const total = members.length + group.unavailableCount;
            const status = aggregateTargetStatus(states.map((item) => item.status), group.unavailableCount);
            return { key: group.groupId, id: group.groupId, title: `${group.name} · ${total} 台设备`,
                checked: total > 0 && checked === total, mixed: checked > 0 && checked < total, status,
                disabled: busy() || !unit() || unit()?.data.qrProjection?.role === "receiver" || !members.length || states.some((item) => item.stopping),
                change: (enabled) => { void change(members, enabled, group.groupId); },
                ...(status.phase === "error" && !states.some((item) => item.stopping) ? {
                    retry: () => { void change(members, groupIntents()[group.groupId] ?? true, group.groupId); },
                } : {}),
            };
        });
    return { rows, refresh, busy, error };
}
