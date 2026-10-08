# LiveRelay 收端诊断与包绑定

## 源端四阶段累计耗时（待新包原生验证）

`get_live_relay_status`的native快照新增可空`sourceTiming`。尚未进入源端工作循环及
viewer为null；现有`.25`包不含此接线，不能用旧EXE验收新字段。它是源会话内累计
统计，重连不归零，新会话独立；不是逐帧历史、分位数或跨机帧龄。

| 阶段 | 测量范围 |
| --- | --- |
| `socketService` | 源循环入口的控制/关闭帧处理调用，不含连接建立及失败后的补充service |
| `latestFrame` | 最新帧锁定与clone；empty包括无新帧和原路径锁失败，不是预算拒绝计数 |
| `adaptation` | 已有JPEG到协商representation及wire framing，含legacy展开/回退，不是capture侧JPEG编码 |
| `socketSend` | binary socket.send返回，成功不是远端ACK，不含ping发送 |

每阶段仅6个u64字段：attempts、succeeded、failed、empty、totalMicros、maxMicros。
耗时由同进程Instant测量，总量包含成功/失败/empty，均值只能除以attempts；不能把
成功次数当全部耗时分母。计数与总和饱和相加，固定内存，不保存像素、URL或错误正文。
只记录正常返回的Result/Option，panic内未完成尝试及poisoned诊断锁不保证留证。

每个源循环用局部聚合，退出作用域时合并一次state锁；网络、图像工作期间不持
诊断锁，错误/停止早退同样合并已返回阶段。正常路径在原10ms sleep之后发布统计，
但sleep不在阶段耗时内；诊断开销仍需原生测量，不宣称零性能影响。快照中的帧计数
与该累计统计可能位于同轮合并前后，不能将差值当作精确单帧关联。

不调整预算、目标FPS、sleep、队列或重连策略；尚未计入WGC、readback、capture JPEG
编码、预算拒绝及GPU。仅此接线和软件回归不能关闭A3-P，也不证明旧低速的根因。

## 采集侧三阶段累计耗时（待新包原生验证）

随后在`get_live_capture_status`增加可空`captureTiming`，与relay的sourceTiming分别
归各自会话owner管理。采集状态初始为null，每轮正常返回的阶段在作用域退出时合并，
重建epoch不清零，新session独立。复用LiveStageTiming的六个固定数值字段，不复用
relay状态或观测列表。三阶段含义如下：

- `handoff`包围整个mailbox.next，包含锁、候选检查、admission、可能的GPU fallback、
  readback及RGB转换，**不是纯readback**。empty只能说明Ok(None)，不能推出预算拒绝。
- `jpegEncode`仅为encode_live_jpeg调用，失败Err同样计时；它不同于relay adaptation。
- `frameStore`包括帧队列锁、Arc包装、push及latest查询，不包括随后state.mark_frame。

原始Result与raw/CPU permit继续由原作用域管理；计时器不拥有或延迟释放它们，网络、
编码及队列工作期间不持诊断state锁。新调用仍有计时与合并开销，不能声称零性能影响。
frameId可能先更新、当轮计时稍后合并，不能强制逐点相等。既有panic/poisoned锁统计
缺失边界仍存在。没有WGC acquisition计时、单独GPU readback计时、admission拒绝分类。

3项新增回归保护handoff结果分类、编码失败不虚构存帧、返回payload所有权和恢复累计。
capture聚焦25 passed/2 ignored，relay聚焦38 passed/4 ignored，预算回归10 passed；
staged投影29项Node检查通过。ignored原生入口未运行；payload夹具不是实际CPU permit
原生释放证明。新包性能验收必须明确要求captureTiming和sourceTiming存在且attempts
推进，不能仅凭兼容旧包的observer passed来声称新诊断生效。

### CPU admission 分类累计（后续接线，待新包原生验证）

在上述三阶段之后补充`captureTiming.cpuAdmission`，仅含`granted`、`policyDenied`、
`lockUnavailable`三个饱和u64计数。它们归每个CaptureBudget实例所有，新实例从零开始，
不是整个进程累计。granted仅表示admit许可，不保证后续readback、JPEG或存帧成功；
policyDenied涵盖全部admit返回None，不能单独解释成CPU算力不足；lockUnavailable
同时包括try_lock竞争与poisoned。没有新帧或提前suppression不会形成try_cpu尝试。

handoff返回后、传播Err之前取得快照；iteration退出时覆盖最新累计值，不重复相加。
三个Relaxed原子读不是整体原子快照，与帧状态及阶段发布也不原子，不强制计数总和
等于handoff attempts。budget实例重建可能归零，当前staged单调校验会拒绝该窗口，
不能据captureTiming跨epoch累计推断budget计数也跨所有恢复累计。

不改变admit判定、ticket公平性、permit构造或Drop cooldown；不新增mutex。但许可和
策略拒绝的原子计数仍在既有预算锁内执行，不能宣称锁持有时间完全不变或零开销。
这些计数不提供拒绝耗时、排队等待时长，也不单独证明JPEG低速因果。

本次预算12 passed、capture26 passed/2 ignored、relay38 passed/4 ignored及staged
30项Node回归通过；快照覆盖、三类真实try_cpu结果、permit释放/cooldown与饱和有回归。
尚未打包或运行新包WGC双机验收，独立readback计时仍缺。兼容旧包的observer通过
不证明新计数存在或推进。证据见`linshi/issue67-source-stage-timing-20261007/admission-receipt.json`。

这是现有实时投射观看窗口的只读证据入口，不是另一套传输或持续遥测服务。

### 消费端 readback 子阶段（后续接线，待新包原生验证）

`captureTiming.readback`新增`stagingCopy`和`mapRgb`，分别复用六字段固定累计统计。
mailbox直接路径和GPU slot fallback路径都接入同一累计值，不区分路径来源。
stagingCopy仅包围Readback::copy的同步CPU调用，包括staging分配及CopyResource提交，
不是GPU copy完成确认；mapRgb包围into_rgb，包含Map重试/等待、分配、BGRA到RGB转换、
Unmap和消费对象释放，不是纯Map syscall或GPU执行耗时。capture callback内的
GpuFrame::copy_for_readback不在这两个测点内，WGC acquisition也未覆盖。

二者是handoff的子阶段，分析不得与handoff再相加造成重复计时。失败返回照常计数，
copy失败不会虚构map或JPEG尝试；panic、poisoned诊断锁边界与已有阶段一致。
没有新增诊断锁、像素复制或纹理历史，permit仍由原raw/返回值持有；fallback的copy
计时在原service/slots锁内执行，因此存在少量计时开销，不宣称锁持有时长完全不变。

为保持行数门禁，将既有fallback函数整体移入live_gpu/worker_fallback.rs，保留
worker::fallback接口与候选顺序、锁作用域、permit释放。最终capture28 passed/2 ignored、
live_gpu28 passed/6 ignored（含12项budget）、relay38 passed/4 ignored、staged31项
Node回归通过。真实D3D fallback测试新增统计断言但仍ignored，不能报告为原生已过。
新候选和两机测量尚未执行；旧`.25`不包含这些测点。

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
| `renderEvidenceSupported` | 当前图像节点的宿主是否支持 Element Timing；true/false，尚未挂载为 null |
| `rendering` | 当前提交帧收到过浏览器 image-paint 记录；无有效记录为 null，不是当前物理可见性或显示确认 |

`presentation` 绑定当前 relay/session、epoch、已提交 frame ID；需要图片仍存在且连接未关闭。
它记录提交时的 controller `generation`、尺寸、JPEG/raw codec、payload/image 字节、
`readMs` / `prepareMs` / `decodeMs` 与 `submittedAtMs`。generation 由 controller 在
读帧和解码返回后检查；此导出不是独立的 generation 验证器。

三个原始帧时间戳 `captureTimestampMs`、`encodeTimestampMs`、`receivedTimestampMs`
仅用于关联；**不直接跨设备相减**。`submittedAtMs` 是收端当前 document 的
`performance.now()`，不是 Unix 时间。epoch 换代、停止或图片清理使旧 presentation 失效。
后续帧解码失败时可能仍保留上一帧，必须看 `presentation.frameId`，不能用 `lastFrameId`
或接收计数冒充最新呈现。`decoded_submitted` 自身没有合成或物理显示确认，也没有全帧分位数。

## 浏览器绘制证据

实际 `LiveRelayLayer` 图像节点由 `LiveRelayImage` 挂载。当宿主支持 PerformanceObserver
的 `element` entry 时，同一 document 共享一个 observer，按 entry.element 分发到对应
图像节点，避免多窗口逐个扫描整份绘制事件；每个节点只接受自己的 `image-paint`：identifier、
当前 URL、relay/session/epoch/frame/generation、解码尺寸、可见 document、非空交集与
当前节点几何必须匹配。绘制时间必须在本帧提交后且不晚于当前收端 `performance.now()`。
URL 只在进程内校验，不输出到诊断属性。

`rendering.evidence` 为 `browser_element_render`，包含 generation、frame ID、
`renderTimeMs` 和 `sinceSubmittedMs`。后二者仅使用同一 document 时钟，表示本次
提交到浏览器记录的绘制时间；不是网络、全链路或跨机帧龄。JPEG/raw 继续使用同一
图像显示路径，不增加 canvas、像素复制、计时器或入站权限。

换帧清单槽；document 隐藏/恢复、图像错误会清记录并设置失效时间，拒绝之前排队的
迟到 entry。清帧或卸载会清除节点支持状态；卸载移除订阅和 listener，最后一个节点
卸载时断开共享 observer，并拒绝其迟到回调。observer 建立失败
或 API 不支持时保留原有 `decoded_submitted` 路径，不用 load/rAF 伪造绘制成功。
记录表示当前帧曾获得浏览器绘制证据；后续 CSS 遮挡、透明度或显示器状态不在其
持续监测范围内。Element Timing 不是 compositor acknowledgement，更不是物理屏幕扫描证明。

从 Hook 根目录运行 `node scripts/test-live-relay-render-browser.mjs <output-directory>`
可挂载生产观看组件并验证实际 Chromium image-paint、换图、CSS 隐藏/恢复、坏图、
epoch 换代、关闭与卸载。只有 native rect sync 与入站 store 数据使用夹具；不代表
真实 WGC、跨设备或目标 WebView2 已通过。输出目录应放在本地临时工作区。

2026-10-07 已另用独立 Wry/Tao 嵌入式宿主，在 WebView2 Runtime `154.0.4258.62`
中复用同一生产观看组件夹具，验证 image-paint、连续换帧、隐藏/恢复、坏图、epoch/
generation 换代、关闭和卸载后迟到结果；图片 URL 归零。该宿主使用隔离 profile、
loopback 页面和进程退出清理边界，不注册全局输入 Hook、不启用 CDP，也不退出日常 Hook。
此结果补充目标 runtime 的软件层兼容证据，**不是 v0.2.32.25 Hook EXE 的运行验收**：
入站 store 与 native rect sync 仍是夹具，真实采集、跨机、合成确认和物理显示均未测试。
上述 Chromium 命令不运行这个原生宿主；不能用浏览器版本号或诊断 buildVersion 替代包绑定。

### 已绑定 .25 候选的双机原生补验

2026-10-07 随后完成重新打包的内部 `.25` 候选实测，SHA-256 为
`401c0c94f7953d3eeb2a993a940e7a622920618e6f5844f44ee512e172db15a1`。
两台 Windows 的实际 EXE、PID、创建时间和 CDP 父链均已绑定；从正常产品界面发布、
经 Surface 参数面板加入，使用真实 WGC 采集和 LAN HTTPS/WSS 媒体。SSH 仅用于管理，
不转发媒体。接收端页面为 `http://tauri.localhost/`，WebView2 为 `154.0.4258.62`。

各阶段使用唯一 raw CDP 连接、250 ms 间隔串行采样，不启用 `Network.enable`：

| 原生窗口阶段 | 样本数 | 不同的已核验绘制帧 | 当次无当前绘制证据的样本 | 实际 document 状态 |
| --- | --- | --- | --- | --- |
| 可见 | 80 | 55 | 25 | `visible` |
| 最小化 | 8 | 6 | 2 | `visible` |
| 恢复后 | 80 | 63 | 17 | `visible` |

最小化采样前后均确认同一原生窗口 `IsIconic=true`，恢复后为 false；恢复阶段的绘制帧
推进到 1843，晚于最小化阶段最后提交的 1142。上述数量是离散采样，不是 FPS、全帧历史
或漏帧率；单槽没有当前绘制记录的样本也保留，不能用接收计数填补。
可见、恢复后与关闭截图均已核看。正常停止后图片归零，`presentation`、`rendering`
均为 null；双机专用进程和监听清理、日常 `.23` 恢复通过。

**原生最小化不等于网页隐藏。** 该宿主的最小化窗口仍报告 `document.visibilityState`
为 `visible`；仅 raw CDP 和断开 Playwright 后的对照也如此，不归因于 Playwright。
旧的“最小化必须进入 hidden”失败记录保留，不重命名为通过、不伪造网页状态或放宽权限。
本候选的真正 document-hidden 失效场景仍未覆盖，既有组件夹具的隐藏回归不能代替它。
本次只通过实际候选的软件绘制、最小化/恢复推进与停止清帧；未验证合成确认、物理显示
或完整性能矩阵，也不把内部 dirty candidate 当作正式发布或关闭整个 A3-D。

同日再对相同 SHA 的 `.25` EXE 做单机隔离入口探测：通过现有 `hide_to_tray` /
`show_canvas_window` 产品命令隐藏到托盘并恢复，原生 `IsWindowVisible` 依次为
true/false/true；各阶段 8 次、250 ms 间隔的 raw CDP 采样均为 document `visible`。
因此托盘隐藏也不能提供本包的 document-hidden 验收前提。探测未启动媒体、未修改
网页状态或产品权限，不能证明隐藏时的 LiveRelay 清帧；候选正常退出及专用监听清理通过。
实际调用链只转发原生窗口 hide/show，没有调用 Wry 的 WebView `SetIsVisible`。
后续若验证真正网页隐藏，应先建立合法可达的宿主转换，再执行媒体失效断言；
不重复用最小化或托盘隐藏冒充该转换，也不因当前路径未触发而删除隐藏防护。

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

资源和内存测量应使用唯一的 raw CDP 观察连接，不启用 `Network` 域。Playwright 的
Chromium setup connection 会启用网络记录；开始资源观察前须断开所有 setup connection，
并记录实际发出的 CDP methods。另一条连接上的 `Network.disable` 不会清除原 session
的记录，不能仅凭采样器自己没有调用 `Network.enable` 就认定环境无干扰。
本机原生 WebView2 的受控 JPEG 解码对照已证明这项记录能显著保留私有内存；它不是
双机真实投射无泄漏的证明。保留历史失败与原阈值，消除观察工具干扰后另做真实媒体验收。
raw CDP 建连前的 `/json/version` 探测应关闭 HTTP keep-alive，否则探测连接可能与
WebSocket 同时占用调试端口。`TargetInfo.attached` 不携带 session 身份，不能单凭
该布尔值认定 Playwright setup 仍连接；应分别核对建连前零条、观察中唯一一条
loopback CDP TCP 连接及其进程归属，并保留实际发送的 CDP methods。

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
其他网络/设备/性能与物理显示矩阵仍需各自的包绑定原生基线；本页单场景通过不覆盖它们。
