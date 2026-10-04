# LiveRelay 收端诊断与包绑定

这是现有实时投射观看窗口的只读证据入口，不是另一套传输或持续遥测服务。
先沿 [正常产品入口](LIVE_CAPTURE.md#cross-device-liverelay-entry) 发布、受权加入。
QR 图片投射、tile wall、模拟 IPC 或浏览器夹具不能代替原生两机验收。

## 当前单槽证据

每个可见 viewer 的根元素都有 `data-live-relay-diagnostic` JSON 属性。
`liveRelayDiagnostics.ts` 只从当前状态构造固定字段，不保存历史、不读取媒体字节，
不发 HTTP、不取得权限，也不引入采样 timer。窗口移除后属性随 DOM 移除。

| 字段 | 语义 |
| --- | --- |
| `schemaVersion` / `path` | 当前为 `1` / `live_relay`，不能混入其他投射路径 |
| `buildVersion` | 编译时内部版本；不是二进制 SHA 或当前进程身份 |
| `packageBinding` | `external_process_sha256_required`；要求另核实际进程，绝不自行宣称已绑定 |
| `relayId` / `liveSessionId` / `sourceDeviceId` / `sourceHookId` | 当前观看及发现时的源身份；单字段最多 256 个 ASCII 标识符字符，缺失/非法为 null |
| `epoch` / `receivedFrames` / `overwrittenFrames` / `reconnectCount` | native 状态计数；不等于不同显示画面数或物理 FPS |
| `hasError` | 是否存在错误；不输出错误正文、标题、URL、观察值或凭证 |
| `presentation` | 当前已解码并提交的单帧；没有有效证据时为 null |

`presentation` 绑定当前 relay/session、epoch、已提交 frame ID；需要图片仍存在且连接未关闭。
它记录提交时的 controller `generation`、尺寸、JPEG/raw codec、payload/image 字节、
`readMs` / `prepareMs` / `decodeMs` 与 `submittedAtMs`。generation 由 controller 在
读帧和解码返回后检查；此导出不是独立的 generation 验证器。

三个原始帧时间戳 `captureTimestampMs`、`encodeTimestampMs`、`receivedTimestampMs`
仅用于关联；**不直接跨设备相减**。`submittedAtMs` 是收端当前 document 的
`performance.now()`，不是 Unix 时间。epoch 换代、停止或图片清理使旧 presentation 失效。
后续帧解码失败时可能仍保留上一帧，必须看 `presentation.frameId`，不能用 `lastFrameId`
或接收计数冒充最新呈现。没有合成回调、物理显示确认或全帧分位数。

## 有界读取

在受信任的候选 WebView2/CDP 工具中只读取该属性，不序列化整个 store/DOM。
以下是一次快照，不启动持续循环；最多 32 个窗口，每槽最多 4096 字符：

```javascript
const slots = document.querySelectorAll('[data-live-relay-diagnostic]');
if (slots.length > 32) throw new Error('live_relay_diagnostic_view_limit');
const snapshot = {
  schemaVersion: 1,
  clockOriginMs: performance.timeOrigin,
  sampledAtMs: performance.now(),
  viewers: Array.from(slots, (slot) => {
    const text = slot.getAttribute('data-live-relay-diagnostic');
    if (!text || text.length > 4096) throw new Error('live_relay_diagnostic_size');
    return JSON.parse(text);
  }),
};
JSON.stringify(snapshot);
```

只使用已获授权的诊断连接，不为采样启用公网调试端口或更改设备权限。输出放到独立
证据目录，不覆盖旧文件。若外部工具做重复采样，最多 600 秒/6000 次，串行读取；
document 重载或 `clockOriginMs` 变化时重新分段。单槽会漏掉中间帧，必须报告缺口。

## 实际包与进程绑定

DOM 无权读取本机 EXE；版本相同也可能是不同构建。原生试验必须另外记录：

1. 本轮两个 Hook 包和 Loom daemon 的 SHA-256、各自源码提交与构建 provenance。
2. 实际运行 Hook 的 PID、进程开始时间和 `ExecutablePath`；路径必须等于选定候选。
3. 对该进程路径上的 EXE 算 SHA-256，并与候选 provenance 的 `artifact.sha256` 比较。
4. CDP listener 的 owner 或其已验证进程父链属于该 Hook；不能仅凭端口、窗口标题或版本。
5. 快照的 `buildVersion` 等于候选 provenance；快照文件本身也记录 SHA-256。

Windows 只读核对的核心操作如下（变量由候选验收工具提供，不填凭证）：

```powershell
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $hookProcessId"
if (-not $process -or -not $process.ExecutablePath) { throw 'Hook process identity unavailable' }
$actualPath = [IO.Path]::GetFullPath($process.ExecutablePath)
if ($actualPath -ine [IO.Path]::GetFullPath($expectedExePath)) { throw 'Hook process path mismatch' }
$actualSha256 = (Get-FileHash -LiteralPath $actualPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -cne $expectedSha256.ToLowerInvariant()) { throw 'Hook process digest mismatch' }
```

进程退出、PID/开始时间变化或无法读路径时停止，不能退回“任选同名进程”。构建后的
headless self-check 绑定的是实际 EXE/hash，不是这个观看窗口的原生显示验收。
最终包回执应区分 `artifact-verified`、`process-bound`、`native-viewer-observed`，没有执行
的阶段留未验证；不要把未绑定的浏览器快照与某个新包拼成两机结果。

## 与 Loom 发送采样对齐

使用 Loom 仓库的 `scripts/measure-live-relay.mjs` 读取相同授权会话，分别保存两端证据。
A1 的 `identity` 是 UTF-8 `JSON.stringify([liveSessionId, sourceDeviceId])` 的 SHA-256
前 32 个十六进制字符；epoch/frame ID 可进一步关联。发送单槽与收端单槽都不是全帧历史，
不能要求每个 frame 都匹配。跨机时钟未校准时只比较各自阶段耗时，不计算端到端帧龄。

原始设备/会话 ID 只留受信本地证据；公开报告使用与 A1 一致的指纹，不发布原始 ID、
图像、OCR、授权 URL 或环境变量。生产代码不主动落盘、不保留图像副本或持久采样数组。
真实网络、CPU/GPU、首次画面、恢复/撤销、慢 viewer 与物理显示属于后续包绑定原生基线。
