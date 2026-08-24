const MAX_BROWSER_EVENTS = 256;
const MAX_EVENT_TEXT_LENGTH = 4096;

const boundedText = (value) => String(value).slice(0, MAX_EVENT_TEXT_LENGTH);

export const createBrowserEventRecorder = (page) => {
    const events = [];
    const record = (event) => {
        events.push(event);
        if (events.length > MAX_BROWSER_EVENTS) {
            events.splice(0, events.length - MAX_BROWSER_EVENTS);
        }
    };
    const onConsole = (message) => record({
        type: "console",
        level: message.type(),
        text: boundedText(message.text()),
        location: message.location(),
    });
    const onPageError = (error) => record({ type: "pageerror", text: boundedText(error) });
    const onRequestFailed = (request) => record({
        type: "requestfailed",
        url: boundedText(request.url()),
        failure: request.failure(),
    });
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", onRequestFailed);

    return {
        reset() {
            events.length = 0;
        },
        snapshot() {
            return [...events];
        },
        dispose() {
            page.off("console", onConsole);
            page.off("pageerror", onPageError);
            page.off("requestfailed", onRequestFailed);
            events.length = 0;
        },
    };
};
