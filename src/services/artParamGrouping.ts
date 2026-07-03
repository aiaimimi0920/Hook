import type { ArtParam } from "./protocol";

export interface ArtParamGroup {
    id: string;
    label: string;
    params: ArtParam[];
    defaultExpanded: boolean;
}

const GROUP_THRESHOLD = 8;

const BUILTIN_PHOTO_GROUPS: Array<{
    id: string;
    label: string;
    defaultExpanded: boolean;
    matches: (paramId: string) => boolean;
}> = [
    {
        id: "basic",
        label: "基础",
        defaultExpanded: true,
        matches: (paramId) => ["strength", "skin_protection"].includes(paramId),
    },
    {
        id: "exposure_contrast",
        label: "曝光 / 对比",
        defaultExpanded: true,
        matches: (paramId) =>
            ["gamma", "exposure", "contrast", "highlights", "shadows", "whites", "blacks"].includes(paramId),
    },
    {
        id: "color",
        label: "色彩",
        defaultExpanded: true,
        matches: (paramId) => ["temperature", "tint", "saturation", "vibrance", "hue"].includes(paramId),
    },
    {
        id: "split_toning_advanced",
        label: "分离色调 / 高级",
        defaultExpanded: true,
        matches: (paramId) => paramId.startsWith("split_"),
    },
];

const slugifyGroupLabel = (label: string) => {
    const slug = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "group";
};

const resolveGroupForParam = (param: ArtParam): Omit<ArtParamGroup, "params"> => {
    if (param.group?.trim()) {
        const label = param.group.trim();
        return {
            id: `custom-${slugifyGroupLabel(label)}`,
            label,
            defaultExpanded: true,
        };
    }

    const paramId = param.id.toLowerCase();
    const builtin = BUILTIN_PHOTO_GROUPS.find((group) => group.matches(paramId));
    if (builtin) {
        return {
            id: builtin.id,
            label: builtin.label,
            defaultExpanded: builtin.defaultExpanded,
        };
    }

    return {
        id: "other",
        label: "其他",
        defaultExpanded: true,
    };
};

export const shouldGroupArtParams = (params: readonly ArtParam[]) =>
    params.length > GROUP_THRESHOLD || params.some((param) => !!param.group?.trim());

export const buildArtParamGroups = (params: readonly ArtParam[]): ArtParamGroup[] => {
    if (!shouldGroupArtParams(params)) {
        return [
            {
                id: "all",
                label: "参数",
                params: [...params],
                defaultExpanded: true,
            },
        ];
    }

    const groups: ArtParamGroup[] = [];
    const indexById = new Map<string, number>();

    params.forEach((param) => {
        const groupMeta = resolveGroupForParam(param);
        let groupIndex = indexById.get(groupMeta.id);
        if (groupIndex === undefined) {
            groupIndex = groups.length;
            indexById.set(groupMeta.id, groupIndex);
            groups.push({
                ...groupMeta,
                params: [],
            });
        }
        groups[groupIndex].params.push(param);
    });

    return groups;
};
