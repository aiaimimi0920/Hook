import { describe, expect, it } from "vitest";
import type { ArtParam } from "../../src/services/protocol";
import {
    buildArtParamGroups,
    shouldGroupArtParams,
} from "../../src/services/artParamGrouping";

const slider = (id: string, label = id, group?: string): ArtParam => ({
    id,
    label,
    widget: "slider",
    min: 0,
    max: 100,
    step: 1,
    default: 0,
    ...(group ? { group } : {}),
});

describe("art parameter grouping", () => {
    it("keeps small parameter sets flat unless a group is explicitly provided", () => {
        const params = [slider("strength"), slider("gamma")];

        expect(shouldGroupArtParams(params)).toBe(false);
        expect(buildArtParamGroups(params)).toEqual([
            {
                id: "all",
                label: "参数",
                params,
                defaultExpanded: true,
            },
        ]);
    });

    it("groups Color Transfer style controls into compact editing sections", () => {
        const groups = buildArtParamGroups([
            slider("strength"),
            slider("gamma"),
            slider("exposure"),
            slider("contrast"),
            slider("highlights"),
            slider("shadows"),
            slider("whites"),
            slider("blacks"),
            slider("temperature"),
            slider("tint"),
            slider("saturation"),
            slider("vibrance"),
            slider("hue"),
            slider("split_h_hue"),
            slider("split_h_sat"),
            slider("split_s_hue"),
            slider("split_s_sat"),
            slider("split_balance"),
            { ...slider("skin_protection"), widget: "checkbox", default: false },
        ]);

        expect(groups.map((group) => [group.id, group.label, group.defaultExpanded])).toEqual([
            ["basic", "基础", true],
            ["exposure_contrast", "曝光 / 对比", true],
            ["color", "色彩", true],
            ["split_toning_advanced", "分离色调 / 高级", true],
        ]);
        expect(groups.find((group) => group.id === "basic")?.params.map((param) => param.id)).toEqual([
            "strength",
            "skin_protection",
        ]);
    });

    it("uses explicit art param groups before built-in photo grouping", () => {
        const groups = buildArtParamGroups([
            slider("gamma", "Gamma", "My Group"),
            slider("temperature", "Temperature"),
        ]);

        expect(groups.map((group) => [group.id, group.label])).toEqual([
            ["custom-my-group", "My Group"],
            ["color", "色彩"],
        ]);
        expect(groups[0].defaultExpanded).toBe(true);
    });
});
