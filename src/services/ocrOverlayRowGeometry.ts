export interface OcrRowBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface OcrRowGeometryBlock {
    text: string;
    bounds: OcrRowBounds;
    lineHeightHint?: number;
}

interface RowMember {
    index: number;
    center: number;
    height: number;
}

interface VisualRow {
    center: number;
    height: number;
    members: RowMember[];
}

const median = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

const isSingleLine = (text: string) => !/[\r\n]/.test(text);

const collectVisualRows = <T extends OcrRowGeometryBlock>(blocks: T[]) => {
    const members = blocks.flatMap((block, index) => {
        const height = block.bounds.maxY - block.bounds.minY;
        return isSingleLine(block.text) && Number.isFinite(height) && height > 0
            ? [{
                index,
                center: (block.bounds.minY + block.bounds.maxY) / 2,
                height,
            }]
            : [];
    }).sort((left, right) =>
        left.center - right.center
        || blocks[left.index].bounds.minX - blocks[right.index].bounds.minX,
    );

    const rows: VisualRow[] = [];
    for (const member of members) {
        const row = rows[rows.length - 1];
        const threshold = row
            ? Math.max(2, Math.min(row.height, member.height) * 0.5)
            : 0;
        if (!row || Math.abs(member.center - row.center) > threshold) {
            rows.push({ center: member.center, height: member.height, members: [member] });
            continue;
        }
        row.members.push(member);
        row.center = median(row.members.map((candidate) => candidate.center));
        row.height = median(row.members.map((candidate) => candidate.height));
    }
    return rows;
};

/** Rebuilds padded detector boxes as collision-free cells around OCR row centres. */
export const normalizeOcrRowGeometry = <T extends OcrRowGeometryBlock>(blocks: T[]): T[] => {
    const rows = collectVisualRows(blocks);
    if (rows.length < 2) return blocks;

    const referenceHeight = median(rows.flatMap((row) => row.members.map((member) => member.height)));
    const spacings = rows.slice(1).flatMap((row, index) => {
        const spacing = row.center - rows[index].center;
        return spacing > 0 && spacing <= referenceHeight * 1.75 ? [spacing] : [];
    });
    if (spacings.length === 0) return blocks;

    const lineHeight = Math.max(1, Math.min(referenceHeight * 0.9, median(spacings)));
    const adjusted = blocks.map((block) => ({
        ...block,
        bounds: { ...block.bounds },
    }));
    for (const row of rows) {
        for (const member of row.members) {
            adjusted[member.index].lineHeightHint = lineHeight;
            adjusted[member.index].bounds.minY = row.center - lineHeight / 2;
            adjusted[member.index].bounds.maxY = row.center + lineHeight / 2;
        }
    }

    for (let index = 0; index + 1 < rows.length; index += 1) {
        const current = rows[index];
        const next = rows[index + 1];
        const currentBottom = current.center + lineHeight / 2;
        const nextTop = next.center - lineHeight / 2;
        if (currentBottom <= nextTop) continue;
        const boundary = (current.center + next.center) / 2;
        current.members.forEach((member) => {
            adjusted[member.index].bounds.maxY = Math.min(adjusted[member.index].bounds.maxY, boundary);
        });
        next.members.forEach((member) => {
            adjusted[member.index].bounds.minY = Math.max(adjusted[member.index].bounds.minY, boundary);
        });
    }

    return adjusted.filter((block) =>
        block.bounds.maxX > block.bounds.minX && block.bounds.maxY > block.bounds.minY,
    );
};
