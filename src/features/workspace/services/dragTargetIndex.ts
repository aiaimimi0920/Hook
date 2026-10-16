import type { Unit } from "../types/unit";

const CASCADE_GRID_CELL_SIZE = 256;
const CASCADE_COARSE_GRID_CELL_SIZE = 4_096;
const MAX_CASCADE_CELLS_PER_TARGET = 256;
const ALIGNMENT_BUCKET_SIZE = 32;

export type DragTarget = Pick<Unit, "id" | "x" | "y" | "w" | "h"> & {
    order: number;
};

export type CascadeTargetQuery = {
    target: DragTarget | null;
    candidateCount: number;
};

export type AlignmentTargetQuery = {
    xTargets: DragTarget[];
    yTargets: DragTarget[];
};

export type DragTargetIndex = {
    findCascadeTarget: (x: number, y: number) => CascadeTargetQuery;
    findAlignmentTargets: (
        x: number,
        y: number,
        width: number,
        height: number,
        threshold: number,
    ) => AlignmentTargetQuery;
};

type AxisBuckets = Map<number, DragTarget[]>;
type CascadeGrid = Map<number, Map<number, DragTarget[]>>;

const toBucket = (value: number, bucketSize: number) => Math.floor(value / bucketSize);

const addToAxisBucket = (buckets: AxisBuckets, value: number, target: DragTarget) => {
    const bucket = toBucket(value, ALIGNMENT_BUCKET_SIZE);
    const targets = buckets.get(bucket);
    if (targets) {
        targets.push(target);
    } else {
        buckets.set(bucket, [target]);
    }
};

const addToCascadeCell = (grid: CascadeGrid, cellX: number, cellY: number, target: DragTarget) => {
    let column = grid.get(cellX);
    if (!column) {
        column = new Map<number, DragTarget[]>();
        grid.set(cellX, column);
    }

    const targets = column.get(cellY);
    if (targets) {
        targets.push(target);
    } else {
        column.set(cellY, [target]);
    }
};

const collectAxisTargets = (
    firstBuckets: AxisBuckets,
    firstValue: number,
    secondBuckets: AxisBuckets,
    secondValue: number,
    threshold: number,
) => {
    const candidates = new Set<DragTarget>();
    const collect = (buckets: AxisBuckets, value: number) => {
        const startBucket = toBucket(value - threshold, ALIGNMENT_BUCKET_SIZE);
        const endBucket = toBucket(value + threshold, ALIGNMENT_BUCKET_SIZE);
        for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
            const targets = buckets.get(bucket);
            if (!targets) continue;
            for (const target of targets) {
                candidates.add(target);
            }
        }
    };

    collect(firstBuckets, firstValue);
    collect(secondBuckets, secondValue);
    return Array.from(candidates).sort((left, right) => left.order - right.order);
};

export const buildDragTargetIndex = (
    units: readonly Unit[],
    excludedUnitIds: ReadonlySet<string>,
): DragTargetIndex => {
    const cascadeGrid: CascadeGrid = new Map();
    const coarseCascadeGrid: CascadeGrid = new Map();
    const extremeCascadeTargets: DragTarget[] = [];
    const rightXEdges: AxisBuckets = new Map();
    const leftXEdges: AxisBuckets = new Map();
    const bottomYEdges: AxisBuckets = new Map();
    const topYEdges: AxisBuckets = new Map();

    units.forEach((unit, order) => {
        if (excludedUnitIds.has(unit.id)) return;

        const target: DragTarget = {
            id: unit.id,
            x: unit.x,
            y: unit.y,
            w: unit.w,
            h: unit.h,
            order,
        };
        const left = Math.min(target.x, target.x + target.w);
        const right = Math.max(target.x, target.x + target.w);
        const top = Math.min(target.y, target.y + target.h);
        const bottom = Math.max(target.y, target.y + target.h);
        const startCellX = toBucket(left, CASCADE_GRID_CELL_SIZE);
        const endCellX = toBucket(right, CASCADE_GRID_CELL_SIZE);
        const startCellY = toBucket(top, CASCADE_GRID_CELL_SIZE);
        const endCellY = toBucket(bottom, CASCADE_GRID_CELL_SIZE);
        const coveredCellCount = (endCellX - startCellX + 1) * (endCellY - startCellY + 1);

        if (coveredCellCount <= MAX_CASCADE_CELLS_PER_TARGET) {
            for (let cellX = startCellX; cellX <= endCellX; cellX += 1) {
                for (let cellY = startCellY; cellY <= endCellY; cellY += 1) {
                    addToCascadeCell(cascadeGrid, cellX, cellY, target);
                }
            }
        } else {
            const startCoarseCellX = toBucket(left, CASCADE_COARSE_GRID_CELL_SIZE);
            const endCoarseCellX = toBucket(right, CASCADE_COARSE_GRID_CELL_SIZE);
            const startCoarseCellY = toBucket(top, CASCADE_COARSE_GRID_CELL_SIZE);
            const endCoarseCellY = toBucket(bottom, CASCADE_COARSE_GRID_CELL_SIZE);
            const coveredCoarseCellCount =
                (endCoarseCellX - startCoarseCellX + 1) *
                (endCoarseCellY - startCoarseCellY + 1);

            if (coveredCoarseCellCount > MAX_CASCADE_CELLS_PER_TARGET) {
                extremeCascadeTargets.push(target);
            } else {
                for (let cellX = startCoarseCellX; cellX <= endCoarseCellX; cellX += 1) {
                    for (let cellY = startCoarseCellY; cellY <= endCoarseCellY; cellY += 1) {
                        addToCascadeCell(coarseCascadeGrid, cellX, cellY, target);
                    }
                }
            }
        }

        addToAxisBucket(rightXEdges, target.x + target.w, target);
        addToAxisBucket(leftXEdges, target.x, target);
        addToAxisBucket(bottomYEdges, target.y + target.h, target);
        addToAxisBucket(topYEdges, target.y, target);
    });

    return {
        findCascadeTarget: (x, y) => {
            const cellX = toBucket(x, CASCADE_GRID_CELL_SIZE);
            const cellY = toBucket(y, CASCADE_GRID_CELL_SIZE);
            const localTargets = cascadeGrid.get(cellX)?.get(cellY) ?? [];
            const coarseCellX = toBucket(x, CASCADE_COARSE_GRID_CELL_SIZE);
            const coarseCellY = toBucket(y, CASCADE_COARSE_GRID_CELL_SIZE);
            const coarseTargets = coarseCascadeGrid.get(coarseCellX)?.get(coarseCellY) ?? [];
            let matchedTarget: DragTarget | null = null;

            const inspect = (target: DragTarget) => {
                if (matchedTarget && matchedTarget.order > target.order) return;
                if (
                    x >= target.x && x <= target.x + target.w &&
                    y >= target.y && y <= target.y + target.h
                ) {
                    matchedTarget = target;
                }
            };

            for (const target of localTargets) inspect(target);
            for (const target of coarseTargets) inspect(target);
            for (const target of extremeCascadeTargets) inspect(target);

            return {
                target: matchedTarget,
                candidateCount: localTargets.length + coarseTargets.length + extremeCascadeTargets.length,
            };
        },
        findAlignmentTargets: (x, y, width, height, threshold) => ({
            xTargets: collectAxisTargets(
                rightXEdges,
                x,
                leftXEdges,
                x + width,
                threshold,
            ),
            yTargets: collectAxisTargets(
                bottomYEdges,
                y,
                topYEdges,
                y + height,
                threshold,
            ),
        }),
    };
};
