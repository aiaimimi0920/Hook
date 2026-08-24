  const loadEntry = async (entryBase64) => {
    if (
      typeof entryBase64 !== "string"
      || entryBase64.length === 0
      || entryBase64.length > MAX_ENTRY_BASE64_CHARS
      || entryBase64.length % 4 === 1
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(entryBase64)
    ) {
      throw new Error("JavaScript Surface entry is missing");
    }
    const decoded = atob(entryBase64);
    if (decoded.length > MAX_ENTRY_BYTES) throw new Error("JavaScript Surface entry is too large");
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/javascript" }));
    try {
      await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // `once: true` 在监听器被“调用”时就摘掉它，而不是在它成功时；下面两个 return 却是按
  // “不匹配就忽略、继续等真正的 surface:init”写的，两者对不上。任何早到一步的 message 事件
  // 都会把这唯一一次机会用掉，此后 surface 永远起不来：入口不 import、ready 不发，宿主只
  // 能等到心跳超时，而报出来的位置离真正的原因很远。所以自己在接受 init 之后再摘监听器。
  const onHostMessage = async (event) => {
    if (port || event.data?.type !== "surface:init" || !event.ports?.[0]) return;
    // 只接父窗口发来的 init。宿主帧是 opaque origin，宿主只能用 "*" 发（见
    // JavaScriptSurface.tsx 里那处注释），所以 event.origin 不是可靠的判据，发件人才是。
    // 今天不是活着的漏洞——沙箱没有 allow-same-origin，监听器在任何 surface 模块能跑之前
    // 就注册好了——但这个检查不要钱。
    if (event.source !== globalThis.parent) return;
    if (typeof event.data.token !== "string" || !SAFE_TOKEN.test(event.data.token)) return;
    globalThis.removeEventListener("message", onHostMessage);
    token = event.data.token;
    context = { snapshot: event.data.snapshot, resources: event.data.resources || {} };
    port = event.ports[0];
    port.onmessage = (messageEvent) => {
      const message = messageEvent.data;
      if (!message || message.token !== token || disposed) return;
      runtimeMessageTail = runtimeMessageTail.then(async () => {
        if (disposed) return;
        if (message.type === "snapshot") {
          context = { snapshot: message.snapshot, resources: message.resources || {} };
          await invoke("update", {
            snapshot: structuredClone(context.snapshot),
            resources: Object.freeze({ ...context.resources }),
          });
        } else if (message.type === "suspend") {
          clearTimers();
          await invoke("suspend", undefined);
        } else if (message.type === "resume") {
          await invoke("resume", undefined);
        } else if (message.type === "pointer") {
          dispatchSyntheticPointer(message.pointer);
        } else if (message.type === "release-editable-focus") {
          pendingEditableFocusTarget = null;
          blurActiveEditable();
        } else if (message.type === "restore-editable-focus") {
          if (pendingEditableFocusTarget?.isConnected) pendingEditableFocusTarget.focus();
          pendingEditableFocusTarget = null;
        } else if (message.type === "dispose") {
          await dispose();
        }
      }).catch((error) => { fail(error); });
    };
    port.start();
    try {
      await loadEntry(event.data.entryBase64);
      await start();
    } catch (error) {
      fail(error);
      await dispose();
    }
  };
  globalThis.addEventListener("message", onHostMessage);
})();
