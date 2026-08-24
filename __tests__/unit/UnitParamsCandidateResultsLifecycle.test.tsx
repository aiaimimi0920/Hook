// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/api", () => ({
    api: { readImageFromPath: vi.fn() },
}));

import { UnitParamsCandidateResults } from "../../src/components/UnitParamsCandidateResults";
import { api } from "../../src/services/api";
import type { ArtResultCandidate } from "../../src/services/protocol";
import type { Unit } from "../../src/types/unit";

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
};

const candidate = (path: string, src: string): ArtResultCandidate => ({
    index: 0,
    title: "Candidate A",
    imageUrl: "https://example.com/a.png",
    cachedThumbnailPath: path,
    cachedThumbnailSrc: src,
});

const buildUnit = (firstCandidate: ArtResultCandidate): Unit => ({
    id: "candidate-unit",
    type: "art",
    artId: "test-art",
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    params: { result_index: 0 },
    inputs: [],
    outputs: [],
    data: {
        selectedResultIndex: 0,
        resultCandidates: [
            firstCandidate,
            {
                index: 1,
                title: "Candidate B",
                imageUrl: "https://example.com/b.png",
            },
        ],
    },
});

const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("UnitParamsCandidateResults async fallback lifecycle", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("ignores an old fallback after a path-only candidate update and accepts the current request", async () => {
        const oldRead = deferred<string>();
        const currentRead = deferred<string>();
        vi.mocked(api.readImageFromPath)
            .mockReturnValueOnce(oldRead.promise)
            .mockReturnValueOnce(currentRead.promise);
        const [unit, setUnit] = createSignal(buildUnit(candidate("C:/old.png", "asset://old")));
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsCandidateResults
                    unit={unit()}
                    params={unit().params}
                    onParamChange={() => undefined}
                />
            ),
            host,
        );

        const oldImage = host.querySelector<HTMLImageElement>("[data-art-candidate-index='0'] img")!;
        oldImage.dispatchEvent(new Event("error"));
        expect(api.readImageFromPath).toHaveBeenCalledWith("C:/old.png");

        setUnit(buildUnit(candidate("C:/current.png", "asset://current")));
        await flushMicrotasks();
        oldRead.resolve("data:image/png;base64,STALE");
        await flushMicrotasks();
        const currentImage = host.querySelector<HTMLImageElement>("[data-art-candidate-index='0'] img")!;
        expect(currentImage.getAttribute("src")).toBe("asset://current");

        currentImage.dispatchEvent(new Event("error"));
        expect(api.readImageFromPath).toHaveBeenLastCalledWith("C:/current.png");
        currentRead.resolve("data:image/png;base64,CURRENT");
        await flushMicrotasks();
        expect(currentImage.getAttribute("src")).toBe("data:image/png;base64,CURRENT");
        dispose();
    });

    it("does not publish a fallback after disposal", async () => {
        const read = deferred<string>();
        vi.mocked(api.readImageFromPath).mockReturnValueOnce(read.promise);
        const unit = buildUnit(candidate("C:/late.png", "asset://before-dispose"));
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsCandidateResults
                    unit={unit}
                    params={unit.params}
                    onParamChange={() => undefined}
                />
            ),
            host,
        );
        const image = host.querySelector<HTMLImageElement>("[data-art-candidate-index='0'] img")!;
        image.dispatchEvent(new Event("error"));
        dispose();
        read.resolve("data:image/png;base64,LATE");
        await flushMicrotasks();

        expect(image.getAttribute("src")).toBe("asset://before-dispose");
        expect(host.querySelector("[data-art-candidate-index='0']")).toBeNull();
    });
});
