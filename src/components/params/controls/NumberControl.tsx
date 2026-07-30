import { Component, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { api } from "../../../services/api";
import { clampOptional, normalizePrecision } from "../../../utils/math";

interface NumberControlProps {
  id: string;
  label: string;
  widget: "slider" | "number";
  value: number;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  isDisabled: boolean;
  onChange: (value: number, isFinal: boolean) => void;
  onContextMenu: (e: MouseEvent) => void;
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return String(normalizePrecision(value));
};

export const NumberControl: Component<NumberControlProps> = (props) => {
  const [draftValue, setDraftValue] = createSignal("");
  const [isEditing, setIsEditing] = createSignal(false);
  const [isSliderDragging, setIsSliderDragging] = createSignal(false);
  const [isSliderHovered, setIsSliderHovered] = createSignal(false);
  let sliderTrackRef: HTMLDivElement | undefined;
  let sliderDragCleanup: (() => void) | undefined;

  const fallbackValue = () => finiteOr(props.default, props.min ?? 0);
  const currentValue = () => clampOptional(finiteOr(props.value, fallbackValue()), props.min, props.max);
  const sliderMin = () => finiteOr(props.min, 0);
  const sliderMax = () => {
    const fallbackMax = Math.max(sliderMin() + effectiveStep(), currentValue(), 100);
    const nextMax = finiteOr(props.max, fallbackMax);
    return nextMax >= sliderMin() ? nextMax : sliderMin();
  };
  const sliderRange = () => Math.max(sliderMax() - sliderMin(), 0);
  const sliderProgress = () => {
    const range = sliderRange();
    if (range <= 0) return 0;
    return (currentValue() - sliderMin()) / range;
  };
  const effectiveStep = () => {
    const step = finiteOr(props.step, 1);
    return step > 0 ? step : 1;
  };

  createEffect(() => {
    if (!isEditing()) {
      setDraftValue(formatNumber(currentValue()));
    }
  });

  const parseDraft = () => {
    const parsed = Number(draftValue());
    if (!Number.isFinite(parsed)) return undefined;
    return normalizePrecision(clampOptional(parsed, props.min, props.max));
  };

  const parseDraftInputValue = (raw: string) => {
    if (!raw.trim()) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    return normalizePrecision(clampOptional(parsed, props.min, props.max));
  };

  const stopInteractiveEvent = (event: Event) => {
    event.stopPropagation();
  };

  const focusEditableTarget = (
    event:
      | (MouseEvent & { currentTarget: HTMLInputElement })
      | (PointerEvent & { currentTarget: HTMLInputElement }),
  ) => {
    stopInteractiveEvent(event);
    if (props.isDisabled) return;
    const target = event.currentTarget;
    target.focus();
    void api.focusOverlayWindow().finally(() => {
      requestAnimationFrame(() => target.focus());
    });
  };

  const commitDraft = () => {
    const next = parseDraft();
    setIsEditing(false);

    if (next === undefined) {
      setDraftValue(formatNumber(currentValue()));
      return;
    }

    setDraftValue(formatNumber(next));
    props.onChange(next, true);
  };

  const adjustByStep = (direction: -1 | 1) => {
    if (props.isDisabled) return;
    const next = normalizePrecision(clampOptional(currentValue() + effectiveStep() * direction, props.min, props.max));
    setIsEditing(false);
    setDraftValue(formatNumber(next));
    props.onChange(next, true);
  };

  const handleSliderInput = (value: string, isFinal: boolean) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;

    const next = normalizePrecision(clampOptional(parsed, props.min, props.max));
    setIsEditing(false);
    setDraftValue(formatNumber(next));
    props.onChange(next, isFinal);
  };

  const quantizeSliderValue = (rawValue: number) => {
    const min = sliderMin();
    const range = sliderRange();
    if (range <= 0) return normalizePrecision(min);
    const unclamped = min + Math.max(0, Math.min(1, rawValue)) * range;
    const step = effectiveStep();
    const stepped = step > 0 ? min + Math.round((unclamped - min) / step) * step : unclamped;
    return normalizePrecision(clampOptional(stepped, props.min, props.max));
  };

  const resolveSliderValueFromClientX = (clientX: number) => {
    const rect = sliderTrackRef?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return currentValue();
    }
    const ratio = (clientX - rect.left) / rect.width;
    return quantizeSliderValue(ratio);
  };

  const clearSliderDrag = () => {
    sliderDragCleanup?.();
    sliderDragCleanup = undefined;
    setIsSliderDragging(false);
  };

  const startSliderDrag = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
    event.preventDefault();
    event.stopPropagation();
    if (props.isDisabled) return;

    void api.focusOverlayWindow();
    setIsEditing(false);
    setIsSliderDragging(true);

    const applyFromClientX = (clientX: number, isFinal: boolean) => {
      const next = resolveSliderValueFromClientX(clientX);
      setDraftValue(formatNumber(next));
      handleSliderInput(String(next), isFinal);
    };

    applyFromClientX(event.clientX, false);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      applyFromClientX(moveEvent.clientX, false);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      upEvent.preventDefault();
      applyFromClientX(upEvent.clientX, true);
      clearSliderDrag();
    };

    clearSliderDrag();
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    sliderDragCleanup = () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  };

  onCleanup(() => {
    clearSliderDrag();
  });

  const label = (
    <label
      class="text-[#EEF1FF]/80 font-medium text-[11px] truncate cursor-context-menu"
      style={{ "min-width": "70px", "max-width": "104px" }}
      onContextMenu={(event) => props.onContextMenu(event)}
    >
      {props.label}
    </label>
  );

  const stepper = (
    <div class="flex items-center shrink-0 overflow-hidden rounded border border-white/10 bg-white/5">
      <button
        type="button"
        data-param-step-down
        disabled={props.isDisabled}
        class="w-5 h-6 flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          adjustByStep(-1);
        }}
      >
        -
      </button>
      <input
        type="number"
        data-param-number-input
        min={props.min}
        max={props.max}
        step={props.step ?? "any"}
        class="w-16 h-6 bg-transparent border-x border-white/10 px-1 text-center text-white/90 text-[11px] placeholder-white/20 focus:outline-none focus:bg-white/10 disabled:opacity-50"
        value={draftValue()}
        disabled={props.isDisabled}
        onInput={(event) => {
          setIsEditing(true);
          const nextDraft = event.currentTarget.value;
          setDraftValue(nextDraft);
          if (props.isDisabled) return;
          const next = parseDraftInputValue(nextDraft);
          if (next === undefined) return;
          props.onChange(next, false);
        }}
        onChange={(event) => {
          setDraftValue(event.currentTarget.value);
          commitDraft();
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setIsEditing(false);
            setDraftValue(formatNumber(currentValue()));
          }
        }}
        onPointerDown={focusEditableTarget}
        onMouseDown={focusEditableTarget}
        onClick={stopInteractiveEvent}
        onContextMenu={(event) => {
          stopInteractiveEvent(event);
          props.onContextMenu(event);
        }}
      />
      <button
        type="button"
        data-param-step-up
        disabled={props.isDisabled}
        class="w-5 h-6 flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          adjustByStep(1);
        }}
      >
        +
      </button>
    </div>
  );

  return (
    <div class="w-full min-w-0" onPointerDown={(event) => event.stopPropagation()}>
      <Show
        when={props.widget === "slider"}
        fallback={
          <div data-param-number-layout class="flex items-center justify-between gap-2 w-full min-w-0 min-h-6">
            {label}
            {stepper}
          </div>
        }
      >
        <div data-param-slider-layout class="flex flex-col gap-1.5 w-full min-w-0">
          <div data-param-value-row class="flex items-center justify-between gap-2 w-full min-w-0">
            {label}
            {stepper}
          </div>
          <div
            data-param-slider-row
            class="w-full min-w-0"
            style={{
              "padding-left": "14px",
              "padding-right": "6px",
            }}
          >
            <div
              ref={sliderTrackRef}
              data-param-slider-track
              aria-disabled={props.isDisabled}
              class="param-slider-track relative w-full min-w-0 rounded-full"
              style={{
                height: "18px",
                cursor: props.isDisabled ? "not-allowed" : "ew-resize",
                opacity: props.isDisabled ? 0.5 : 1,
              }}
              onMouseDown={startSliderDrag}
              onContextMenu={(event) => props.onContextMenu(event)}
            >
              <div
                class="absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full bg-white/12"
                style={{ height: "6px" }}
              />
              <div
                class="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-violet-400/80"
                style={{
                  height: "6px",
                  width: `${sliderProgress() * 100}%`,
                }}
              />
              <div
                data-param-slider-thumb
                class="absolute"
                onMouseDown={startSliderDrag}
                onMouseEnter={() => setIsSliderHovered(true)}
                onMouseLeave={() => setIsSliderHovered(false)}
                style={{
                  left: `${sliderProgress() * 100}%`,
                  top: "-9px",
                  width: "20px",
                  height: "18px",
                  cursor: props.isDisabled ? "not-allowed" : "ew-resize",
                  "pointer-events": props.isDisabled ? "none" : "auto",
                  transform: "translateX(-50%)",
                }}
              >
                <div
                  data-param-slider-thumb-visual
                  class="absolute left-1/2"
                  style={{
                    bottom: "2px",
                    width: "12px",
                    height: "8px",
                    background:
                      isSliderDragging() || isSliderHovered()
                        ? "rgba(196, 181, 253, 1)"
                        : "rgba(167, 139, 250, 0.96)",
                    "clip-path": "polygon(50% 100%, 0 0, 100% 0)",
                    "transform-origin": "50% 100%",
                    filter:
                      isSliderDragging() || isSliderHovered()
                        ? "drop-shadow(0 0 1px rgba(255,255,255,0.98)) drop-shadow(0 0 8px rgba(167,139,250,0.75))"
                        : "drop-shadow(0 0 0.5px rgba(255,255,255,0.85)) drop-shadow(0 1px 3px rgba(139,92,246,0.45))",
                    transform: `translateX(-50%) scale(${
                      isSliderDragging() ? 1.12 : isSliderHovered() ? 1.08 : 1
                    })`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
