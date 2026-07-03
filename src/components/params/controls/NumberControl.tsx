import { Component, Show, createEffect, createSignal } from "solid-js";
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

  const fallbackValue = () => finiteOr(props.default, props.min ?? 0);
  const currentValue = () => clampOptional(finiteOr(props.value, fallbackValue()), props.min, props.max);
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

  const label = (
    <label
      class="text-[#EEF1FF]/80 font-medium text-[11px] truncate cursor-context-menu"
      style={{ "min-width": "70px", "max-width": "104px" }}
      onContextMenu={props.onContextMenu}
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
          setDraftValue(event.currentTarget.value);
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
        onContextMenu={props.onContextMenu}
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
          <div data-param-slider-row class="w-full min-w-0">
            <input
              type="range"
              data-param-slider
              min={props.min ?? 0}
              max={props.max ?? 100}
              step={props.step ?? "any"}
              value={currentValue()}
              disabled={props.isDisabled}
              class="w-full min-w-0 accent-violet-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              onInput={(event) => handleSliderInput(event.currentTarget.value, false)}
              onChange={(event) => handleSliderInput(event.currentTarget.value, true)}
              onContextMenu={props.onContextMenu}
            />
          </div>
        </div>
      </Show>
    </div>
  );
};
