# 开发与验证

[English](development.md) · [Documentation / 文档中心](../README.md)

以下命令均在仓库根目录执行；贡献流程与代码归属以[工程贡献规范](../../CONTRIBUTING.md)为准。

Tauri v2 · SolidJS · TypeScript · Rust

```powershell
npm ci
npm run dev:tauri
```


## 运行与开发要求

- Windows 10 或 Windows 11；
- WebView2 Runtime；
- 前端开发使用 Node.js 22 系列的 22.12 或更高版本；使用 `npm ci` 安装锁定依赖，
  不为初始化 checkout 顺便更新依赖版本；
- 桌面编译使用 Rust stable 与 MSVC 工具链。

只有所选 Windows 11 显示器报告 HDR 支持时才会进入 HDR 路径；不支持或内容仅为
SDR 时会自动降级。详见 [`docs/features/HDR_CAPTURE.md`](../features/HDR_CAPTURE.md)。

常用检查：

```powershell
npm run typecheck
npm run typecheck:test
npm run lint
npm run test:performance
npm run test:surface-browser
npm run test:parallel
npm test
npm run probe:live-screenshot:phase2
npm run probe:live-screenshot:phase3
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` 会执行完整的串行验证，并继续构建和打包本地 Release；它不
是轻量级的 lint 命令。

实时截图 G2 探针默认在交互式桌面运行 600 秒。它使用同权限、持续变化的 WinForms
夹具验证 WGC 新帧、尺寸变化后的重建、源关闭 fail-closed、会话清理，以及句柄和
私有内存增长上限；证据写入 `artifacts/live-screenshot-phase2/<run-id>`，不提交到
Git。本地 WebView 展示通过 Tauri 原始二进制响应读取有界 JPEG 帧，不把帧塞进
`loom.surface.v1`，也不进行逐帧 JSON/Base64 传输。

G3 探针只覆盖已锁定的 Windows 11、单 SDR 显示器、同权限 Win32/WinForms 范围：
源窗口变成接近透明的合成器窗口后仍产生变化帧，并验证独立输入边沿、精确恢复、
本地抢回、恢复日志执行和 worker 清理。该结果不承诺原生最小化、提权/跨会话、
WPF、WinUI 或任意自定义控件兼容。

## 浏览器与原生候选验收

`test:surface-browser` 启动隔离 headless Chromium，验证 JavaScript Surface 的
健康、定时器、DOM、CPU 长任务与堆预算路径；不启动第二个原生 Otter，也不绕过单实例锁。

原生候选必须显式指定本次 EXE 和匹配的 SHA-256，不使用脚本中的历史默认包或哈希：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\Invoke-OtterNativeCandidateAcceptance.ps1 `
  -OtterExe ..\release\Otter\candidate\otter.exe `
  -ExpectedSha256 <candidate-sha256> `
  -PreflightOnly
```

预检只检查文件、哈希、CDP 依赖/端口和既有主进程/watchdog，不启动或停止 Otter。
所有现有实例正常退出后，移除 `-PreflightOnly` 才执行真实 WebView2/Tauri IPC、
单实例拒绝、默认 600 秒进程树 soak、正常退出、watchdog/CDP 清理和重启恢复。
脚本使用隔离 app data/WebView2 storage，仅为候选启用验收退出命令，不绕过全局锁。

Otter + Loom 联合验收使用 `scripts/Invoke-OtterLoomSurfaceCandidateAcceptance.ps1`，
显式传入 `-OtterExe`、`-ExpectedOtterSha256`、`-LoomPackageDir` 和
`-ExpectedLoomDaemonSha256`。先加 `-PreflightOnly`；仅验证隔离 Loom 服务时改用
`-ValidateLoomServicesOnly`，两者都不能替代完整桌面联调。

正常退出所有现有 Otter 主进程/watchdog 后，省略这两个开关才执行完整包到包的
Surface 点击、资源与正式结果链路、十分钟 soak、正常退出、重启恢复和进程/监听器清理。
必须等候 `frontend-initialized`，不能以 CDP 可连接代替前端就绪。待授权设备只能在隔离
Loom 控制面按精确公钥批准；旧验收结果不认证新二进制。完整命令示例见
[英文开发指南](development.md)。验收使用当前应用数据身份与正式协议，不恢复废弃兼容路径。

## 本地打包

直接构建便携 exe：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-local-otter-exe.ps1 `
  -OutputDir ..\release\Otter\local-build `
  -Force
```

开发规则见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md)，当前运行时结构见
[`docs/architecture/overview.md`](../architecture/overview.md)。

开发 CI 中有效的漏洞、许可、lint、格式和行数发现由独立 advisory 工作流报告；
工具、报告、上传失败仍是错误，类型检查、构建和功能测试仍阻塞。发布检查及
`verify:local` 保持严格，详见[依赖安全策略](../security/DEPENDENCY_SECURITY.md)。
