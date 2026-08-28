import type { BarcodeResult } from "../types/unit";
import { api } from "./api";
import { buildBarcodeOutputValues } from "./barcodeRecognition";
import { syncService } from "./syncService";
import { graphStore } from "../store/graphStore";
import { uiActions } from "../store/uiStore";

type PropagateFromUnit = (unitId: string) => void;

let barcodePropagation: PropagateFromUnit | undefined;

/** Registers the graph propagation callback owned by the unit-action hook. */
export const registerBarcodePropagation = (propagate: PropagateFromUnit): void => {
    barcodePropagation = propagate;
};

export const copyBarcodeResult = async (unitId: string, result: BarcodeResult): Promise<void> => {
    const copied = await api.copyTextToClipboard(result.text);
    uiActions.showEnhancementNotice(unitId, copied
        ? { feature: "Barcode", title: "识别内容已复制", message: "识别结果已写入系统剪贴板。" }
        : { feature: "Barcode", title: "复制失败", message: "系统剪贴板暂时不可用，请重试。" });
};

export const openBarcodeResultUrl = async (unitId: string, result: BarcodeResult): Promise<void> => {
    if (!result.url) return;
    try {
        await api.openUrl(result.url);
        uiActions.showEnhancementNotice(unitId, {
            feature: "Barcode",
            title: "已请求打开链接",
            message: "链接已交给系统默认浏览器处理。",
        });
    } catch {
        uiActions.showEnhancementNotice(unitId, {
            feature: "Barcode",
            title: "链接打开失败",
            message: "仅支持有效的 HTTP(S) 地址，请复制后手动打开。",
        });
    }
};

export const selectBarcodeResult = (unitId: string, resultId: string): void => {
    const unit = graphStore.units.find((candidate) => candidate.id === unitId);
    const scan = unit?.data.barcodeResult;
    if (!unit || !scan?.results.some((result) => result.id === resultId)) return;
    const selectedScan = { ...scan, selectedId: resultId };
    graphStore.actions.updateUnitData(unitId, {
        barcodeResult: selectedScan,
        outputs: {
            ...unit.data.outputs,
            ...buildBarcodeOutputValues(selectedScan),
        },
    });
    void syncService.performWorkflowSync();
    queueMicrotask(() => barcodePropagation?.(unitId));
    uiActions.showEnhancementNotice(unitId, {
        feature: "Barcode",
        title: "已切换主识别结果",
        message: "recognized_url 与 recognized_text 输出已更新，可继续连接到 Art。",
    });
};
