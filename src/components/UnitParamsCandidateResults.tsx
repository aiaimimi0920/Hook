import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { EXEC_manualTrigger } from "../constants";
import {
    buildOptimisticCandidateSelectionPatch,
    resolveCandidateCardPreviewSrc,
} from "../services/artCandidateCache";
import { api } from "../services/api";
import { buildArtCandidateSetFingerprint } from "../services/artCandidateSetFingerprint";
import { normalizeImageSourceForDisplay } from "../services/imageSource";
import { graphStore } from "../store/graphStore";
import { Unit } from "../types/unit";

type ResultCandidate = NonNullable<Unit["data"]["resultCandidates"]>[number];

interface UnitParamsCandidateResultsProps {
    unit: Unit;
    params: Record<string, unknown>;
    onParamChange: (propId: string, value: unknown, isFinal?: boolean) => void;
}

/** Owns the generic multi-result picker shown for Arts that return candidates. */
export const UnitParamsCandidateResults: Component<UnitParamsCandidateResultsProps> = (props) => {
    const resultCandidates = () => props.unit.data.resultCandidates || [];
    const candidateSetSignature = createMemo(() =>
        buildArtCandidateSetFingerprint(resultCandidates()),
    );
    const [candidateFallbackSrcs, setCandidateFallbackSrcs] =
        createSignal<Record<number, string>>({});
    const candidatePreviewFallbacksInFlight = new Map<number, number>();
    let candidateGeneration = 0;
    let disposed = false;

    createEffect(() => {
        candidateSetSignature();
        candidateGeneration += 1;
        candidatePreviewFallbacksInFlight.clear();
        setCandidateFallbackSrcs({});
    });
    onCleanup(() => {
        disposed = true;
        candidateGeneration += 1;
        candidatePreviewFallbacksInFlight.clear();
    });

    const selectedResultIndex = () => {
        const runtimeSelected = props.unit.data.selectedResultIndex;
        if (typeof runtimeSelected === "number" && Number.isFinite(runtimeSelected)) {
            return runtimeSelected;
        }
        const paramSelected = props.params.result_index;
        return typeof paramSelected === "number" && Number.isFinite(paramSelected)
            ? Math.floor(paramSelected)
            : undefined;
    };

    const selectCandidate = (candidate: ResultCandidate) => {
        graphStore.actions.updateUnitData(
            props.unit.id,
            buildOptimisticCandidateSelectionPatch(props.unit, candidate),
        );
        props.onParamChange("result_index", candidate.index, false);
        props.onParamChange(EXEC_manualTrigger, Date.now(), true);
    };

    const setCandidateFallbackSrc = (candidateIndex: number, src: string) => {
        setCandidateFallbackSrcs((prev) =>
            prev[candidateIndex] === src
                ? prev
                : {
                      ...prev,
                      [candidateIndex]: src,
                  },
        );
    };

    const resolveCandidateFallbackPath = (candidate: ResultCandidate) =>
        candidate.cachedThumbnailPath || candidate.cachedImagePath;

    const isCandidateRequestCurrent = (
        unitId: string,
        candidateIndex: number,
        fallbackPath: string,
        generation: number,
    ) => {
        if (disposed || generation !== candidateGeneration || props.unit.id !== unitId) return false;
        const currentCandidate = resultCandidates().find((item) => item.index === candidateIndex);
        return !!currentCandidate && resolveCandidateFallbackPath(currentCandidate) === fallbackPath;
    };

    const handleCandidatePreviewError = async (candidate: ResultCandidate) => {
        const candidateIndex = candidate.index;
        const unitId = props.unit.id;
        const generation = candidateGeneration;
        const fallbackPath = resolveCandidateFallbackPath(candidate);
        const currentCandidate = resultCandidates().find((item) => item.index === candidateIndex);
        if (!currentCandidate || currentCandidate !== candidate) return;
        const selectedPreviewSrc =
            candidateIndex === selectedResultIndex()
                ? normalizeImageSourceForDisplay(props.unit.data.previewSrc)
                : undefined;
        if (selectedPreviewSrc) {
            setCandidateFallbackSrc(candidateIndex, selectedPreviewSrc);
        }

        if (
            !fallbackPath ||
            candidatePreviewFallbacksInFlight.get(candidateIndex) === generation
        ) {
            return;
        }

        candidatePreviewFallbacksInFlight.set(candidateIndex, generation);
        try {
            const fallbackSrc = await api.readImageFromPath(fallbackPath);
            if (isCandidateRequestCurrent(unitId, candidateIndex, fallbackPath, generation)) {
                setCandidateFallbackSrc(candidateIndex, fallbackSrc);
            }
        } catch (error) {
            if (isCandidateRequestCurrent(unitId, candidateIndex, fallbackPath, generation)) {
                console.warn(
                    "[UnitParamsPanel] Failed to load candidate thumbnail fallback",
                    candidateIndex,
                    error,
                );
            }
        } finally {
            if (candidatePreviewFallbacksInFlight.get(candidateIndex) === generation) {
                candidatePreviewFallbacksInFlight.delete(candidateIndex);
            }
        }
    };

    return (
        <Show when={resultCandidates().length > 1}>
            <div class="flex-shrink-0 px-4 pb-3">
                <div class="hook-panel-caption flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em]">
                    <span>候选</span>
                    <span>
                        当前{" "}#{(selectedResultIndex() ?? 0) + 1}
                    </span>
                </div>
                <div
                    class="mt-2 grid gap-2"
                    style={{
                        "grid-template-columns": "repeat(auto-fit, minmax(68px, 1fr))",
                    }}
                >
                    <For each={resultCandidates()}>
                        {(candidate) => {
                            const selected = () => candidate.index === selectedResultIndex();
                            const previewSrc = () =>
                                candidateFallbackSrcs()[candidate.index] ||
                                resolveCandidateCardPreviewSrc(candidate, {
                                    isSelected: selected(),
                                    selectedPreviewSrc: props.unit.data.previewSrc,
                                });
                            return (
                                <button
                                    type="button"
                                    data-art-candidate-index={candidate.index}
                                    data-image-search-candidate-index={candidate.index}
                                    class="hook-candidate-card flex flex-col gap-1 p-1.5 text-left transition-colors"
                                    style={{
                                        border: selected()
                                            ? "1px solid color-mix(in srgb, var(--theme-signal) 90%, transparent)"
                                            : "1px solid var(--theme-border)",
                                        "box-shadow": selected()
                                            ? "0 0 0 1px color-mix(in srgb, var(--theme-signal) 25%, transparent)"
                                            : "none",
                                    }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        selectCandidate(candidate);
                                    }}
                                >
                                    <span
                                        class="hook-candidate-preview overflow-hidden"
                                        style={{ width: "100%", height: "54px" }}
                                    >
                                        <img
                                            src={previewSrc()}
                                            alt={candidate.title || `候选 ${candidate.index + 1}`}
                                            loading="lazy"
                                            onError={() => {
                                                void handleCandidatePreviewError(candidate);
                                            }}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                "object-fit": "cover",
                                                display: "block",
                                            }}
                                        />
                                    </span>
                                    <span class="hook-candidate-title truncate text-[10px] font-semibold">
                                        {candidate.title || `候选 ${candidate.index + 1}`}
                                    </span>
                                    <span class="hook-candidate-index text-[9px]">
                                        #{candidate.index + 1}
                                    </span>
                                </button>
                            );
                        }}
                    </For>
                </div>
                <div class="hook-separator mt-2 h-px" />
            </div>
        </Show>
    );
};
