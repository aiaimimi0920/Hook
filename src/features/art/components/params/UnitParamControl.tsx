
import { Component, Match, Switch } from "solid-js";
import { ArtParam } from "../../../../integrations/loom/protocol";
import { NumberControl } from "./controls/NumberControl";
import { StringControl } from "./controls/StringControl";
import { BoolControl } from "./controls/BoolControl";
import { ColorControl } from "./controls/ColorControl";
import { ImageControl } from "./controls/ImageControl";
import { SelectControl } from "./controls/SelectControl";
import { formatArtParamTextValue } from "../../services/artParamTextValue";

interface UnitParamControlProps {
  param: ArtParam;
  value: any;
  isDisabled: boolean;
  onChange: (id: string, value: any, isFinal?: boolean) => void;
  // Separate handlers for row (disable) and control (reset)
  onToggleDisable: (id: string) => void;
  onReset: (id: string, defaultValue: any) => void;

  onLinkStart?: (id: string, x: number, y: number) => void;
  onLinkDrop?: (id: string) => void;
  onLinkMove?: (id: string, e: MouseEvent) => void;
  onLinkHover?: (targetId: string | null) => void;
  onEditStart?: (id: string) => void;
  onPreview?: (id: string, active: boolean) => void;
  isLinked?: boolean;
}

export const UnitParamControl: Component<UnitParamControlProps> = (props) => {
  const getDefault = () => props.param.default;

  const handleReset = (e: MouseEvent, val: any) => {
      e.preventDefault();
      e.stopPropagation();
      props.onReset(props.param.id, val);
  };

  const handleDisable = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      props.onToggleDisable(props.param.id);
  };

  return (
    <div
        class="param-row text-xs relative"
        style={props.isDisabled && !props.isLinked ? { opacity: 0.4 } : {}}
        onContextMenu={handleDisable}
    >
      <Switch fallback={<div>Unknown Widget: {props.param.widget}</div>}>
        <Match when={props.param.widget === "slider" || props.param.widget === "number"}>
            <NumberControl
                id={props.param.id}
                label={props.param.label}
                value={Number(props.value ?? getDefault() ?? 0)}
                min={props.param.min}
                max={props.param.max}
                step={props.param.step}
                isDisabled={props.isDisabled}
                onChange={(val, isFinal) => props.onChange(props.param.id, val, isFinal)}
                onContextMenu={(e) => handleReset(e, getDefault() ?? 0)}
            />
        </Match>

        <Match when={props.param.widget === "checkbox" || props.param.widget === "switch"}>
            <BoolControl
                id={props.param.id}
                label={props.param.label}
                value={Boolean(props.value ?? getDefault() ?? false)}
                widget={props.param.widget as "checkbox" | "switch"}
                isDisabled={props.isDisabled}
                onChange={(val) => props.onChange(props.param.id, val)}
                onContextMenu={(e) => handleReset(e, getDefault() ?? false)}
            />
        </Match>

        <Match when={
            props.param.widget === "text" ||
            props.param.widget === "path" ||
            props.param.widget === "textarea"
        }>
            <StringControl
                id={props.param.id}
                label={props.param.label}
                value={formatArtParamTextValue(props.param, props.value ?? getDefault())}
                multiline={props.param.multiline || props.param.widget === "textarea"}
                isDisabled={props.isDisabled}
                onChange={(val, isFinal) => props.onChange(props.param.id, val, isFinal)}
                onEditStart={() => props.onEditStart?.(props.param.id)}
                onContextMenu={(e) => handleReset(e, getDefault() ?? "")}
            />
        </Match>

        <Match when={props.param.widget === "select" || props.param.widget === "radio"}>
            <SelectControl
                id={props.param.id}
                label={props.param.label}
                value={props.value ?? getDefault()}
                options={props.param.options || []}
                isDisabled={props.isDisabled}
                onChange={(value) => props.onChange(props.param.id, value, true)}
                onContextMenu={(event) => handleReset(event, getDefault())}
            />
        </Match>

        <Match when={props.param.widget === "color"}>
             <ColorControl
                id={props.param.id}
                label={props.param.label}
                value={String(props.value ?? getDefault() ?? "")}
                isDisabled={props.isDisabled}
                onChange={(val) => props.onChange(props.param.id, val)}
                onContextMenu={(e) => {
                    // Special case for color: shift+right click to clear?
                    // Original code: if (e.shiftKey) return; e.preventDefault... props.onParamChange("", ...)
                    // Here we map to Reset with empty string? Or handle in Reset?
                    if (e.shiftKey) return; // Allow browser menu??
                    handleReset(e, "");
                }}
             />
        </Match>

        <Match when={props.param.widget === "file" || props.param.widget === "image_link"}>
             <ImageControl
                id={props.param.id}
                label={props.param.label}
                value={String(props.value ?? getDefault() ?? "")}
                widget={props.param.widget as "file" | "image_link"}
                isDisabled={props.isDisabled}
                onChange={(val, _filename) => {
                      props.onChange(props.param.id, val);
                 }}
                onLinkStart={(x, y) => props.onLinkStart?.(props.param.id, x, y)}
                onLinkDrop={() => props.onLinkDrop?.(props.param.id)}
                onLinkMove={(e) => props.onLinkMove?.(props.param.id, e)}
                isLinked={props.isLinked}
                onLinkHover={props.onLinkHover}
                onPreview={(active) => props.onPreview?.(props.param.id, active)}
                onContextMenu={(e) => handleReset(e, "")}
             />
        </Match>
      </Switch>
    </div>
  );
};
