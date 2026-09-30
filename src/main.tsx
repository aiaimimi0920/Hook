import { render } from "solid-js/web";
// Do not initialize the capture workspace or its global listeners in a tile process.
async function mount() {
    const { default: App } = location.hash === "#tile" || location.hash === "#tile-output"
        ? await import("./components/TileTerminal") : await import("./app");
    render(() => <App />, document.getElementById("app")!);
}
void mount();
