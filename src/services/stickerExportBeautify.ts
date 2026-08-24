/** Export-only background, padding, rounded-corner and shadow composition. */
import type { Unit } from "../types/unit";
import {
    computeBeautifyLayout,
    paintBeautifyBackground,
    resolveBeautifyBackground,
} from "./stickerBeautify";
import { loadImage } from "./stickerCanvas";

export const applyStickerExportBeautify = async (compositeSrc: string, unit: Unit): Promise<string> => {
    const beautify = unit.data.imageEditState?.beautify;
    if (!beautify?.enabled) return compositeSrc;

    const inner = await loadImage(compositeSrc);
    const finitePadding = Number.isFinite(beautify.padding) ? beautify.padding : 0;
    const layout = computeBeautifyLayout(inner.width, inner.height, finitePadding);

    const canvas = document.createElement("canvas");
    canvas.width = layout.outerWidth;
    canvas.height = layout.outerHeight;
    const context = canvas.getContext("2d");
    if (!context) return compositeSrc;

    paintBeautifyBackground(
        context,
        resolveBeautifyBackground(beautify.backgroundId),
        layout.outerWidth,
        layout.outerHeight,
    );

    const finiteCornerRadius = Number.isFinite(beautify.cornerRadius) ? beautify.cornerRadius : 0;
    const radius = Math.max(0, Math.min(finiteCornerRadius, layout.innerWidth / 2, layout.innerHeight / 2));

    context.save();
    if (beautify.shadow) {
        context.shadowColor = "rgba(0, 0, 0, 0.35)";
        context.shadowBlur = Math.max(8, Math.round(finitePadding / 2));
        context.shadowOffsetY = Math.max(4, Math.round(finitePadding / 4));
    }
    context.beginPath();
    context.roundRect(layout.innerX, layout.innerY, layout.innerWidth, layout.innerHeight, radius);
    context.closePath();
    context.fillStyle = "#ffffff";
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.roundRect(layout.innerX, layout.innerY, layout.innerWidth, layout.innerHeight, radius);
    context.clip();
    context.drawImage(inner, layout.innerX, layout.innerY, layout.innerWidth, layout.innerHeight);
    context.restore();

    return canvas.toDataURL("image/png");
};
