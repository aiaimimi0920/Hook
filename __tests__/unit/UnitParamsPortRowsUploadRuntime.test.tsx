// @vitest-environment jsdom

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_INLINE_IMAGE_BYTES,
    UnitParamsPortRows,
} from "../../src/components/UnitParamsPortRows";
import type { Unit } from "../../src/types/unit";

class FileReaderMock {
    static readonly EMPTY = 0;
    static readonly LOADING = 1;
    static readonly DONE = 2;
    static instances: FileReaderMock[] = [];
    readonly EMPTY = 0;
    readonly LOADING = 1;
    readonly DONE = 2;
    readyState = FileReaderMock.EMPTY;
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    constructor() {
        FileReaderMock.instances.push(this);
    }

    readAsDataURL() {
        this.readyState = FileReaderMock.LOADING;
    }

    abort() {
        this.readyState = FileReaderMock.DONE;
    }

    finish(result: string) {
        this.readyState = FileReaderMock.DONE;
        this.result = result;
        this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
    }
}

class ImageMock {
    static instances: ImageMock[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 640;
    height = 480;
    naturalWidth = 640;
    naturalHeight = 480;
    src = "";

    constructor() {
        ImageMock.instances.push(this);
    }
}

const UNIT: Unit = {
    id: "upload-unit",
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
};

const chooseFile = (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
};

const renderRows = (onParamChange: (id: string, value: unknown) => void) => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
        () => (
            <UnitParamsPortRows
                unit={UNIT}
                params={{}}
                onParamChange={onParamChange}
                onLinkStart={() => undefined}
                onLinkDrop={() => undefined}
                registerPanelPort={() => undefined}
                toggleParamDisabled={() => undefined}
            />
        ),
        host,
    );
    return { dispose, input: host.querySelector<HTMLInputElement>("input[type='file']")! };
};

describe("UnitParamsPortRows inline image upload", () => {
    beforeEach(() => {
        FileReaderMock.instances = [];
        ImageMock.instances = [];
        vi.stubGlobal("FileReader", FileReaderMock);
        vi.stubGlobal("Image", ImageMock);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("allows only the latest valid selection to commit", () => {
        const onParamChange = vi.fn();
        const { dispose, input } = renderRows(onParamChange);
        chooseFile(input, new File(["old"], "old.png", { type: "image/png" }));
        const oldReader = FileReaderMock.instances[0];
        chooseFile(input, new File(["new"], "new.png", { type: "image/png" }));
        const currentReader = FileReaderMock.instances[1];

        oldReader.finish("data:image/png;base64,OLD");
        expect(ImageMock.instances).toHaveLength(0);
        currentReader.finish("data:image/png;base64,NEW");
        ImageMock.instances[0].onload?.();
        expect(onParamChange).toHaveBeenNthCalledWith(1, "image_path", "data:image/png;base64,NEW");
        expect(onParamChange).toHaveBeenNthCalledWith(2, "image_filename", "new.png");
        dispose();
    });

    it("rejects unsupported and oversized files before reading", () => {
        const onParamChange = vi.fn();
        const { dispose, input } = renderRows(onParamChange);
        chooseFile(input, new File(["text"], "payload.txt", { type: "text/plain" }));
        const oversized = new File(["x"], "huge.png", { type: "image/png" });
        Object.defineProperty(oversized, "size", { value: MAX_INLINE_IMAGE_BYTES + 1 });
        chooseFile(input, oversized);

        expect(FileReaderMock.instances).toHaveLength(0);
        expect(onParamChange).not.toHaveBeenCalled();
        dispose();
    });

    it("does not commit a decoded image after disposal", () => {
        const onParamChange = vi.fn();
        const { dispose, input } = renderRows(onParamChange);
        chooseFile(input, new File(["image"], "late.webp", { type: "image/webp" }));
        FileReaderMock.instances[0].finish("data:image/webp;base64,LATE");
        const image = ImageMock.instances[0];
        dispose();
        image.onload?.();
        expect(onParamChange).not.toHaveBeenCalled();
    });
});
