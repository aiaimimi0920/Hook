/* global window */

export const readPointerControls = async (page, surfaceFrame) => {
    const controls = await surfaceFrame.evaluate(() => {
        const chart = document.querySelector("#chart");
        const input = document.querySelector("#symbol");
        const refresh = document.querySelector("#refresh");
        const rect = (element) => {
            if (!(element instanceof Element)) return null;
            const bounds = element.getBoundingClientRect();
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        };
        return { chart: rect(chart), input: rect(input), refresh: rect(refresh), body: document.body.innerHTML };
    });
    const iframeBox = await page.evaluate(() => {
        const iframe = document.querySelector("iframe");
        if (!(iframe instanceof HTMLIFrameElement)) return null;
        const bounds = iframe.getBoundingClientRect();
        return {
            x: bounds.x,
            y: bounds.y,
            scaleX: bounds.width / iframe.clientWidth,
            scaleY: bounds.height / iframe.clientHeight,
        };
    });
    if (!controls.chart || !controls.input || !controls.refresh || !iframeBox) {
        throw new Error(`pointer-routing controls are unavailable: ${controls.body}`);
    }
    return { controls, iframeBox };
};

export const runPointerInteractions = async ({ page, surfaceFrame, controls, iframeBox }) => {
    const dragStart = {
        x: iframeBox.x + (controls.chart.x + 60) * iframeBox.scaleX,
        y: iframeBox.y + (controls.chart.y + 40) * iframeBox.scaleY,
    };
    const dragEnd = { x: dragStart.x + 80, y: dragStart.y + 40 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    try {
        await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 4 });
    } finally {
        await page.mouse.up().catch(() => {});
    }
    await page.mouse.click(
        iframeBox.x + (controls.input.x + Math.min(20, controls.input.width / 2)) * iframeBox.scaleX,
        iframeBox.y + (controls.input.y + controls.input.height / 2) * iframeBox.scaleY,
    );
    await surfaceFrame.evaluate(() => document.querySelector("#symbol")?.blur());
    await page.evaluate(() => {
        const state = window.__surfacePointerSmoke;
        state.channel.port1.postMessage({ type: "restore-editable-focus", token: state.token });
    });
    await page.waitForTimeout(20);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("SH600000");
    await page.keyboard.press("Control+E");
    await page.keyboard.press("Escape");
    await surfaceFrame.evaluate(() => {
        document.querySelector("#symbol").dataset.consumeEscape = "true";
    });
    await page.keyboard.press("Escape");
    await page.keyboard.down("Control");
    try {
        await page.mouse.wheel(0, -120);
    } finally {
        await page.keyboard.up("Control").catch(() => {});
    }
    await page.keyboard.down("Alt");
    try {
        await page.mouse.wheel(0, 120);
    } finally {
        await page.keyboard.up("Alt").catch(() => {});
    }
    const inputState = await surfaceFrame.evaluate(() => ({
        activeId: document.activeElement?.id,
        value: document.querySelector("#symbol")?.value,
    }));
    await page.mouse.click(
        iframeBox.x + (controls.refresh.x + Math.min(20, controls.refresh.width / 2)) * iframeBox.scaleX,
        iframeBox.y + (controls.refresh.y + controls.refresh.height / 2) * iframeBox.scaleY,
    );
    await page.evaluate(({ chart, input, refresh }) => {
        const state = window.__surfacePointerSmoke;
        const postPointer = (type, point, gestureId) => state.channel.port1.postMessage({
            type: "pointer",
            token: state.token,
            pointer: {
                type,
                gestureId,
                x: point.x,
                y: point.y,
                ctrlKey: false,
                altKey: false,
                shiftKey: false,
                metaKey: false,
            },
        });
        const chartPoint = { x: chart.x + 20, y: chart.y + 20 };
        const inputPoint = { x: input.x + 10, y: input.y + input.height / 2 };
        const refreshPoint = { x: refresh.x + Math.min(20, refresh.width / 2), y: refresh.y + refresh.height / 2 };
        postPointer("mousedown", chartPoint, 101);
        postPointer("mousemove", { x: chartPoint.x + 3, y: chartPoint.y + 2 }, 999);
        postPointer("mousemove", { x: chartPoint.x + 4, y: chartPoint.y + 2 }, 101);
        postPointer("mouseup", chartPoint, 101);
        postPointer("mousedown", inputPoint, 102);
        postPointer("mouseup", inputPoint, 102);
        postPointer("mousedown", refreshPoint, 103);
        postPointer("mouseup", { x: refreshPoint.x + 6, y: refreshPoint.y + 1 }, 103);
        postPointer("mousedown", chartPoint, 201);
        postPointer("mouseup", chartPoint, 202);
        postPointer("mousedown", chartPoint, 203);
        postPointer("mouseup", chartPoint, 203);
        postPointer("mousedown", chartPoint, 301);
        postPointer("mousemove", { x: -20, y: -10 }, 301);
        postPointer("mouseup", { x: -20, y: -10 }, 301);
    }, controls);
    await page.waitForTimeout(50);
    const result = await page.evaluate(() => {
        const state = window.__surfacePointerSmoke;
        const messageTypes = state.messages.map((message) => message?.type);
        const dragStarts = state.messages.filter((message) => message?.type === "host-drag-start");
        const dragMoves = state.messages.filter((message) => message?.type === "host-drag-move");
        const dragEnds = state.messages.filter((message) => message?.type === "host-drag-end");
        const hostWheels = state.messages.filter((message) => message?.type === "host-wheel");
        const hostKeydowns = state.messages.filter((message) => message?.type === "host-keydown");
        return {
            messageTypes,
            activationCount: messageTypes.filter((type) => type === "host-activate").length,
            dragStartCount: dragStarts.length,
            dragMoveCount: dragMoves.length,
            dragEndCount: dragEnds.length,
            dragPointer: dragStarts[0]?.pointer,
            dragPointers: dragStarts.map((message) => message.pointer),
            dragGestureIds: dragStarts.map((message) => message.pointer?.gestureId),
            dragMoveGestureIds: dragMoves.map((message) => message.pointer?.gestureId),
            dragEndGestureIds: dragEnds.map((message) => message.pointer?.gestureId),
            dragEndPointer: dragEnds[0]?.pointer,
            hostWheels: hostWheels.map((message) => message.wheel),
            hostKeydowns: hostKeydowns.map((message) => message.keydown),
            refreshClicks: state.messages.filter(
                (message) => message?.type === "event" && message?.event?.type === "refresh-click",
            ).length,
        };
    });
    result.inputState = inputState;
    return result;
};
