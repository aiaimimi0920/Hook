// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";

const Client = () => <StartClient />;

mount(() => <Client />, document.getElementById("app")!);

export default Client;
