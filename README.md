# Hook

Hook is a node-based visual interface for ArtNexus, built with Tauri and SolidJS.

## Features
- **In-situ Node Editing**: Create and edit nodes directly on your canvas.
- **Workflow Synchronization**: Seamlessly syncs graph state with ArtLoom backend.
- **Real-time Preview**: Shader-based previews for visual arts.
- **Typed API**: Robust communication layer with backend.

## Architecture
- **Frontend**: SolidJS + TypeScript
- **Backend API**: Typed Tauri Commands (`src/services/api.ts`)
- **State Management**: Reactive Stores (`src/store/`)
- **Rendering**: SVG/HTML Hybrid

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run development server:
   ```bash
   npm run tauri dev
   ```

   当前 `tauri dev` 会先做一次静态构建，然后再通过 `scripts/dev-tauri.cmd` 在 `http://127.0.0.1:1420` 提供前端资源。
   这样做的原因是现有 `vinxi dev` 路径在桌面联调里不稳定，而且 Tauri 默认只给前端 dev server 约 180 秒启动窗口；把完整 build 提前到 `scripts/run-tauri.cmd` 里之后，`beforeDevCommand` 只负责起静态 server，就不会再被前端构建时间卡死。
   同时，`npm run dev/build/start` 现在也统一走 `scripts/run-vinxi.cmd`，避免在 Windows 的 UNC 工作目录下被 `CMD.EXE was started with the above path as the current directory` 直接打断。

3. 如果只想预览前端静态页面：
   ```bash
   npm run build
   npm run serve:static
   ```

   这会在浏览器模式下打开 `http://127.0.0.1:1420`。浏览器预览会自动跳过 Tauri 专属命令与事件监听，因此适合做纯前端 UI smoke，但不代表桌面运行态已经接通。

4. 如果只想跑当前 preview + backend 主链 smoke：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\smoke_preview_stack.ps1 -WorkflowId wf-1770163847887
   ```

   这个脚本会检查 `1420 / 1422 / 19820` 是否可用，并执行 workflow IPC smoke。

   如果你希望脚本自己拉起临时 backend，再执行同样的主链 smoke，可以改用：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\smoke_preview_stack_with_backend.ps1 -WorkflowId wf-1770163847887
   ```

5. 如果只想跑当前浏览器回归测试：
   ```bash
   npm run test
   ```

   这组测试当前覆盖 browser preview 下最容易回归的两条链：
   - request socket 不再被 push 广播帧污染
   - shader/session 的 browser fallback 不再退化成 console error

   由于当前仓库位于 Windows UNC 路径下，Vitest 默认的 fork pool 在这台机器上不稳定；脚本已经固定改成 `threads + 单 worker`，避免测试卡死在子进程启动阶段。

   如果要执行当前 Hook 本地完整校验链，可以直接运行：
   ```bash
   npm run verify:local
   ```

   这个入口会按顺序执行：
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `build-hook-release.bat`

6. 如果要做 DOM 级 reference 回归 smoke：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\smoke_reference_roundtrip.ps1 -WorkflowId wf-1770163847887
   ```

   这条脚本会真正打开 headless Chromium，清空 Hook preview session，在 ArtLoom editor 连续点击两次 **“引用到桌面”**，并断言：
   - Hook 节点数是 `0 -> 4 -> 4`
   - ArtLoom 属性面板里的参数值会跟随后端 `workflow_updated` 实时刷新并恢复
   - Hook console 仍然是 `0 errors / 0 warnings`

7. 如果你想一键覆盖当前 browser preview 主矩阵：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\smoke_browser_suite.ps1 -WorkflowId wf-1770163847887
   ```

   这条 suite 会按：
   - preview stack
   - reference roundtrip
   - run workflow success
   - run workflow failure

   的顺序一次性跑完，并在 `runtime-logs/browser-suite-<timestamp>/` 下生成 `summary.json` / `summary.md` / `summary.html`，以及每一步的 `stdout.log / stderr.log / result.json`。GUI 类 step 失败时还会额外落地 `screenshots/*.png`；同时 runtime-logs 根下还会刷新：
   - `browser-suite-latest.json` / `browser-suite-latest.md`
   - `browser-suite-latest-pass.json` / `browser-suite-latest-pass.md`
   - `browser-suite-latest-fail.json` / `browser-suite-latest-fail.md`
   - `browser-suite-index.json` / `browser-suite-index.md`
   - `browser-suite-latest.html`
   - `browser-suite-latest-pass.html`
   - `browser-suite-latest-fail.html`
   - `browser-suite-index.html`

   其中 `summary.md` / `summary.html` 会把 Acceptance Highlights、Primary Failure Summary、UI Observations、Visual Evidence、Reference Roundtrip Key Values、Run Workflow Failure-path Smoke Context、Suite Failure Evidence 等关键信息直接整理成可读报告，并在 Step Results 里直接挂出 screenshot 路径；`summary.html` 还会提供 `Jump to Section`、latest/index 导航、截图 lightbox 预览，便于直接双击浏览。`browser-suite-index.html` 现在也会把 recent reports 额外拆成 PASS / FAIL 摘要卡片，`browser-suite-latest-pass.html` / `browser-suite-latest-fail.html` 则会直接给出当前样本的证据 focus 区块与 `Primary Outcome Summary`。如果通过场景成功落地最终态 screenshot，Visual Evidence 会直接列出对应 step 与截图路径，并附带 markdown image 引用；如果某个 step 失败，Suite Failure Evidence 会直接列出失败 step 数量，以及每个失败 step 的 message、artifact、stdout/stderr、screenshots，并附带 markdown image 引用；`UI Observations` 也会同时列出 `Step status / Step message`，避免失败样本里 artifact 值和 suite 真正状态混淆；若 failure-path smoke 未实际运行到，页面会明确显示 `not run` 和 primary failed step。更完整的覆盖范围与拆分排查顺序，见：
   - [\\192.168.15.200\home\project\project\ArtNexus\plan\端到端闭环验收.md](\\192.168.15.200\home\project\project\ArtNexus\plan\端到端闭环验收.md)

   如果要主动生成一份可控的 failure 样本，刷新 `browser-suite-latest-fail.*`，可以额外传：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\smoke_browser_suite.ps1 `
     -WorkflowId wf-1770163847887 `
     -InjectFailureStep run-workflow-success `
     -InjectFailureMessage "Synthetic suite failure for latest-fail pointer verification."
   ```

   如果要在本地直接模拟正式 CI 入口，而不是手动先跑 PASS 再跑 controlled FAIL，可以改用：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\run_browser_suite_ci.ps1 `
     -WorkflowId wf-1770163847887
   ```

   它会自动：
   - 启动 ArtLoom / Hook 静态预览
   - 生成一份 `ci-pass-*` 样本
   - 生成一份 `ci-fail-*` 样本
   - 校验 `latest-pass` / `latest-fail` 是否已刷新到本轮样本

   注意：
   - 由于 wrapper 会在 PASS 样本之后再跑 controlled FAIL 样本，`browser-suite-latest.*` 会反映最后那轮 synthetic fail
   - 对 CI / 自动化归档来说，应优先看：
     - `browser-suite-latest-pass.*`
     - `browser-suite-latest-fail.*`

   如果当前仓库里还混有大量与 browser-suite 无关的脏改，但你想先导出一份**最小交付包**去做 clean checkout 覆盖、独立审阅或后续远端推送准备，可以执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\export_browser_suite_delivery.ps1 -IncludeArtifacts
   ```

   它会生成一个 `runtime-logs/browser-suite-delivery-<timestamp>/` 目录，里面包含：
   - browser-suite 主线所需的最小源码/脚本/文档集合
   - 当前 `latest*` / `index*` pointer 文件
   - 当前 latest pass/fail 样本目录
   - `DELIVERY_SUMMARY.json`
   - `DELIVERY_SUMMARY.md`

   如果你想进一步从当前脏仓直接准备一份**可推送的干净 worktree checkout**，并把 browser-suite 主线文件自动 stage 好，可以继续执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\prepare_browser_suite_push_checkout.ps1 -BundleDir .\\runtime-logs\\browser-suite-delivery-<timestamp> -IncludeArtifacts -StageChanges
   ```

   它会：
   - 基于当前仓库创建一个独立 worktree checkout
   - 把 delivery bundle 覆盖应用进去
   - 自动切到 `browser-suite-delivery-<timestamp>` 分支
   - 自动 stage browser-suite 主线文件
   - 在目标 checkout 的 `runtime-logs/browser-suite-prepare-<timestamp>/` 下生成：
     - `PREPARE_SUMMARY.md`
     - `PREPARE_TRACE.log`

   如果你已经把 delivery branch 推上远端，还想在本地补一份**远端可见性检查摘要**，可以执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\check_browser_suite_remote_delivery.ps1 -Branch <delivery-branch-name>
   ```

   它会生成：
   - `REMOTE_DELIVERY_SUMMARY.json`
   - `REMOTE_DELIVERY_SUMMARY.md`

   用来确认：
   - 远端 branch 上 workflow raw 文件是否可读
   - 默认分支上是否已经存在同名 workflow
   - compare 页面是否可达
   - actions 页面匿名视角下当前显示什么状态

   如果 delivery branch 已 merge 到默认分支，想继续自动检查：
   - 默认分支上的 workflow raw 是否已经出现
   - Actions 页面是否不再显示 `There are no workflows yet.`

   可以执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\check_browser_suite_post_merge_state.ps1 -Branch <delivery-branch-name> -BaseBranch main
   ```

   它会生成：
   - `POST_MERGE_STATE_SUMMARY.json`
   - `POST_MERGE_STATE_SUMMARY.md`

   并且支持通过：
   - `-TimeoutSec`
   - `-PollIntervalSec`

   持续轮询，直到默认分支 workflow 出现、或 Actions 页面状态变化。

   如果你已经准备把这条 delivery branch 交给登录态操作者去提 PR / merge / trigger，还可以继续生成一份 handoff 摘要：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\generate_browser_suite_pr_handoff.ps1 -Branch <delivery-branch-name>
   ```

   它会生成：
   - `PR_HANDOFF_SUMMARY.json`
   - `PR_HANDOFF_SUMMARY.md`
   - `PR_TITLE.txt`
   - `PR_BODY.md`
   - `POST_MERGE_CHECKLIST.md`

   用来集中列出：
   - compare 页面
   - actions 页面
   - latest pass / latest fail 报告入口
   - 当前 remote-check 结论
   - 推荐给登录态操作者执行的下一步

   如果你想额外证明某条 delivery branch 是否**真的直接基于 `origin/main`**，以及变更文件是否全部落在 delivery manifest 里，可以执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\verify_browser_suite_delivery_branch.ps1 -RepoPath <delivery-worktree-path> -Branch <delivery-branch-name> -BaseRef origin/main
   ```

   它会生成：
   - `DELIVERY_BRANCH_SUMMARY.json`
   - `DELIVERY_BRANCH_SUMMARY.md`

   如果你想把：
   - remote visibility proof
   - PR handoff
   - branch purity proof

   合成一个单独的最终交付包目录，供登录态操作者直接打开执行，可以继续运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ..\\auto\\generate_browser_suite_merge_readiness_packet.ps1 -Branch <delivery-branch-name>
   ```

   它会生成：
   - `MERGE_READINESS_SUMMARY.json`
   - `MERGE_READINESS_SUMMARY.md`
   - `OPERATOR_INDEX.md`
   - `OPERATOR_INDEX.html`
   - `<packet>.zip`
   - `runtime-logs/browser-suite-operator-handoff.json`
   - `runtime-logs/browser-suite-operator-handoff.md`
   - `runtime-logs/browser-suite-operator-handoff.html`
   - `runtime-logs/browser-suite-operator-packet.zip`
   - `runtime-logs/browser-suite-operator-pr-title.txt`
   - `runtime-logs/browser-suite-operator-pr-body.md`
   - `runtime-logs/browser-suite-operator-post-merge-checklist.md`
   - `runtime-logs/browser-suite-operator-compare.url`
   - `runtime-logs/browser-suite-operator-actions.url`
   - `runtime-logs/browser-suite-operator-open.cmd`
   - `runtime-logs/browser-suite-operator-open.ps1`
   - `runtime-logs/browser-suite-operator-watch-post-merge.cmd`
   - `runtime-logs/browser-suite-operator-watch-post-merge.ps1`

   并把以下材料集中复制到同一目录：
   - `REMOTE_DELIVERY_SUMMARY.*`
   - `PR_HANDOFF_SUMMARY.*`
   - `PR_TITLE.txt`
   - `PR_BODY.md`
   - `POST_MERGE_CHECKLIST.md`
   - `DELIVERY_BRANCH_SUMMARY.*`
   - `pass-sample/summary.html`
   - `fail-sample/summary.html`

   对应的 browser-suite workflow 当前保留两份：
   - GitHub-compatible：
     - [\\192.168.15.200\home\project\project\ArtNexus\.github\workflows\browser-suite.yml](\\192.168.15.200\home\project\project\ArtNexus\.github\workflows\browser-suite.yml)
   - Gitea-hosted remote 当前扫描入口：
     - [\\192.168.15.200\home\project\project\ArtNexus\.gitea\workflows\browser-suite.yml](\\192.168.15.200\home\project\project\ArtNexus\.gitea\workflows\browser-suite.yml)

  当前远端 `yamiyu/Hook` 是 Gitea，因此如果目标是让远端 Actions 真正识别 workflow，应优先确保 `.gitea/workflows/browser-suite.yml` 已进入目标分支 / 默认分支；`.github/workflows/browser-suite.yml` 继续保留，作为 GitHub-compatible 镜像和本地对照入口。
  同时，`.gitea/workflows/browser-suite.yml` 现在拆成两层：
  - `linux_amd64:host` preflight：先验证关键 tracked assets 与入口脚本已经进入仓库
  - `windows:host` full suite：继续负责完整 browser-suite 路径

   注意：`.gitea/workflows/browser-suite.yml` 现在是**兼容优先的简化版**，刻意避免依赖当前 Gitea 文档已知不应作为主路径的能力，例如：
   - `workflow_dispatch`
   - `hashFiles(...)`
   - 复杂 `${{ }}` 表达式
   - `GITHUB_STEP_SUMMARY` job summary 输出

   对 Gitea 来说，当前更可信的主触发路径是：
   - merge 到默认分支
   - 或默认分支上的一次匹配 `push`

## 当前依赖关系

Hook 当前的 workflow 主链依赖 ArtLoom backend：

- `http://127.0.0.1:1420`：Hook browser preview
- `ws://127.0.0.1:19820`：ArtLoom IPC backend

没有 `19820` backend 时，Hook browser preview 只能做有限的纯前端预览，不能完成真实 workflow instantiate / update 回写。

## Tea 工单入口

Hook 现在可以通过 Tea 的 HTTP intake 接口创建 AI 工单。这个入口是显式触发的，不会把每次截图、OCR 或 ArtLoom 引用自动转换成工单，避免误刷任务。

桌面运行态支持两种入口：

- 前端面板按钮：右上角 Voice 状态卡里的 `Create Tea Ticket`
- Tauri 托盘菜单：`创建Tea工单`

两种入口都会把当前 Hook 上下文整理为 Tea `POST /v1/intake/hook` 请求：

```json
{
  "source": "hook-desktop",
  "text": "Hook desktop ticket request ...",
  "context": {
    "active_window": null,
    "selection_text": "selected units or voice output",
    "ocr_text": "optional voice transcript",
    "screenshot_ref": null,
    "cwd": "resolved by Rust backend when omitted",
    "app": "hook"
  },
  "attachments": []
}
```

Tea endpoint 和 token 只由 Rust/Tauri 后端读取，不放进 browser preview 前端：

```powershell
$env:HOOK_TEA_BASE_URL = "http://127.0.0.1:48765"
$env:HOOK_TEA_AUTH_TOKEN = "dev-token"
npm run tauri dev
```

可用环境变量：

| 变量 | 用途 |
| :--- | :--- |
| `HOOK_TEA_BASE_URL` | Hook 专用 Tea URL，优先级最高，例如 `http://127.0.0.1:48765` |
| `TEA_SERVER_URL` | 平台通用 Tea URL，作为 `HOOK_TEA_BASE_URL` 的 fallback |
| `HOOK_TEA_AUTH_TOKEN` | Hook 专用 Tea bearer token，优先级最高 |
| `TEA_AUTH_TOKEN` | 平台通用 Tea bearer token，作为 `HOOK_TEA_AUTH_TOKEN` 的 fallback |
| `HOOK_TEA_SOURCE` | 可选 source label，默认 `hook-desktop` |
| `HOOK_TEA_INTAKE_ENABLED=false` | 显式关闭 Hook -> Tea 创建工单入口 |

Browser preview 下 `api.createTeaTicket(...)` 会直接报错 `Tea ticket creation requires the Tauri desktop runtime`。这是刻意设计：browser preview 可以验证 UI/ArtLoom fallback，但不能读取本机 Tea token，也不能代表完整桌面运行态。

如果要验证 Hook Rust intake client 是否真的能打通一个运行中的 Tea daemon，而不是只验证 mock HTTP contract，可以运行根级真实 smoke harness：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\smoke-hook-tea-real.ps1
```

这条 harness 会：

- 构建 `tea-daemon`
- 在 isolated `127.0.0.1:<free-port>` 上启动临时 Tea 服务
- 使用临时 SQLite store
- 设置 `TEA_REAL_SMOKE_BASE_URL` / `TEA_REAL_SMOKE_AUTH_TOKEN`
- 运行 Hook 的 ignored Rust 测试 `tea_real_daemon_smoke`
- 验证 Tea `/v1/tickets/{id}`、`/events`、`/export/markdown`
- 在 `.tmp/tea-smoke/hook-tea-real-<timestamp>/summary.json` 写出证据

如果你已经手动启动了 Tea daemon，也可以直接跑 ignored test：

```powershell
$env:TEA_REAL_SMOKE_BASE_URL = "http://127.0.0.1:48910"
$env:TEA_REAL_SMOKE_AUTH_TOKEN = "dev-token"
cargo test --manifest-path src-tauri/Cargo.toml --test tea_real_daemon_smoke -- --ignored --nocapture
```

这个 smoke 证明的是 Hook 后端 client -> Tea HTTP intake -> Tea store/events/export 的真实链路；它不启动完整 Tauri UI，也不验证前端按钮点击路径。

如果要验证前端面板按钮点击路径，可以运行 Hook UI -> Tea 真实 smoke：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\smoke-hook-tea-ui-real.ps1
```

这条 harness 会：

- 构建 `tea-daemon`
- 构建 Hook 静态前端
- 启动 isolated Tea daemon 和 Hook static preview
- 用 headless Chromium 注入 Tauri `__TAURI_INTERNALS__` invoke bridge
- 点击右上角 Voice 面板里的 `Create Tea Ticket`
- 通过 Tea HTTP 复核 ticket、events、Markdown export
- 在 `.tmp/tea-smoke/hook-tea-ui-real-<timestamp>-<8 hex>/summary.json` 写出前端可见、Tea API 验证、进程/端口 cleanup 证据

这个 smoke 证明的是 Hook 前端按钮 -> Tauri command bridge -> Hook Tea client -> Tea HTTP intake -> Tea store/events/export 的真实链路。它仍然不打开完整 Tauri 桌面窗口；完整桌面启动和原生 tray 入口属于单独的 Tauri desktop smoke 范围。

## Browser Preview vs Tauri Desktop

| 模式 | 已接通能力 | 说明 |
| :--- | :--- | :--- |
| Browser Preview | instantiate、workflow sync、参数回写、session fallback | 适合 workflow 主链 smoke |
| Tauri Desktop | overlay、截图、OCR、原生文件与剪贴板 | 适合完整桌面运行态 |

### Browser Preview 当前限制
- shader prefetch 不走 Tauri-only 路径
- 部分超长 data URL 不会继续持久化进 workflow YAML
- 主要用于验证 ArtLoom <-> Hook workflow 闭环，不等同于桌面全功能

## 现有脚本用途

- `scripts/run-vinxi.cmd`
  - 统一包装 `vinxi dev/build/start`
  - 解决 Windows UNC cwd 问题
- `scripts/serve-static.cmd` / `scripts/serve-static.mjs`
  - 把 `.output/public` 稳定挂到 `1420`
- `scripts/dev-tauri.cmd`
  - Tauri 联调用的静态前端入口
- `scripts/run-tauri.cmd`
  - 在进入 `tauri dev` 前先完成静态构建

## 最小 smoke

1. 确认 ArtLoom backend 在 `19820` 监听
2. 打开 Hook preview：`http://127.0.0.1:1420`
3. 从 ArtLoom workflow editor 点击 **“引用到桌面”**
4. 确认 Hook 出现实例化节点
5. 修改参数后确认：
   - 不再出现 `sync_workflow` timeout warning
   - ArtLoom editor 能看到回流值
   - 同一 workflow 的 reference 再次引用不会无限追加重复节点

> `smoke_preview_stack.ps1` 当前不做 DOM 级 GUI 断言。
> 真正的“引用后节点数是否仍为 4、editor 面板数值是否可见刷新”仍建议手工或 Playwright smoke。

## 参考文档

- [\\192.168.15.200\home\project\project\ArtNexus\plan\端到端闭环验收.md](\\192.168.15.200\home\project\project\ArtNexus\plan\端到端闭环验收.md)

## Recommended IDE Setup
- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
