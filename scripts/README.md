# Engineering tools

顶层脚本是现有命令和自动化使用的稳定入口，不为了目录整洁移动外部调用点。
新工具按下列职责复用入口或归入对应实现目录；不要新增无业务意义的包装层。

| 用途 | 入口/实现 |
| --- | --- |
| 前端开发与构建 | `dev-tauri.cmd`、`build-static.cmd`、`serve-static.cmd`、`run-tauri.cmd` |
| 版本、构建与打包 | `bump-internal-version.ps1`、`build-local-otter-exe.ps1`、`build-release.ps1`、`verify-release.ps1`、`release/` |
| 安全与供应链 | `Invoke-DependencySecurityScan.ps1`、`audit-open-source-dependencies.ps1`、`security/` |
| 代码规模、CI 与文档检查 | `effective-code-lines.mjs`、`ci_change_scope.py`、`check_changed_docs.py` |
| 浏览器验证 | `run-javascript-surface-browser-smoke.mjs`、`javascript-surface-browser-smoke/`、`test-*-browser.mjs` |
| 原生与联合验收 | `Invoke-OtterNativeCandidateAcceptance.ps1`、`native-candidate-acceptance/`、`smoke-otter-tea-*.ps1` |
| 工具测试与现场探针 | `tests/`，按 Node、Python、PowerShell 或真实设备环境分别执行 |
| 生成资源 | `generate-javascript-surface-bootstrap.mjs`、`javascript-surface-bootstrap/`、`capture-homepage-assets/` |

工具必须写明输入、输出、退出码及副作用。截图、录制、输入注入、进程清理、安装、
签名和发布不是普通单元测试；不要在未知环境批量运行探针。
移动脚本时同步检查其根目录推导、调用方、测试、CI、许可证和生成物路径。
历史 effective-line baseline 绑定旧提交，不因当前目录迁移重写。

全仓规则见 [代码组织与开发规范](../docs/development/CODE_ORGANIZATION.md)。
