# Otter 意外退出排查

本页是当前排查入口，不是某个旧候选的验收报告。历史事件、候选哈希与当次测试
结果保留在 Git 历史中；不能据此认定后续意外退出都已有结论。

## 先保存现场

记录事件时间和时区、运行 EXE 的路径与 SHA-256、版本、PID、启动参数，以及
当时是否主动退出、注销、关机或使用紧急退出键。不要先删除日志、重置用户数据、
替换运行程序或强制结束相关进程，否则会丢失归因证据。

运行日志默认位于 `%LOCALAPPDATA%/Otter/logs/otter-runtime.log`；未配置
`LOCALAPPDATA` 时回退到临时目录下的 `Otter/logs/`。`OTTER_LOG_DIR` 可覆盖目录，
并兼容旧 `HOOK_LOG_DIR`；新变量存在时优先。提交日志前检查并脱敏用户内容和凭据。

## 关联证据，而非仅凭窗口消失推断崩溃

- 按时间和 PID 关联 `process_exit_event`、`emergency_watchdog_parent_exited`、
  panic 记录、托盘退出与窗口关闭来源，以及 Windows Application/System 事件。
- `tauri_exit_requested`、`tauri_exit` 和 `tauri_run_returned` 表示不同退出阶段；
  单独一个正常退出记录不能证明最初由谁发起。
- watchdog 的十进制/十六进制退出码是独立进程观察值；没有 panic 或 WER 记录
  也不能排除崩溃。普通日志队列有界且允许丢弃；退出和 panic 记录使用同步尽力写入，
  但磁盘失败、进程强杀等情况仍可能造成证据缺失。
- 旧日志中的 `emergency_triple_escape_exit` 和 `triple_escape` 属于旧触发器，
  不要改写成现有组合键，也不能仅凭键盘事件断言来自真人输入。

## 当前紧急退出行为

连续三次按下 Esc+Delete，每次之间必须完整释放两个键，且相邻组合键间隔严格
小于 400 ms；仅重复 Esc 不触发该状态机。Ctrl+Alt+Shift+F12 仍保留。
原生输入与独立 watchdog 共用 `src-tauri/src/emergency_exit.rs` 中的状态机。
紧急退出属于保护机制，不应为排障关闭或绕过。

## 代码与验证入口

- `src-tauri/src/native/runtime/runtime_logging.rs`：日志目录、队列和同步退出/panic 记录。
- `src-tauri/src/native/runtime/app_runtime.rs`：Tauri 退出阶段记录。
- `scripts/tests/Test-WatchdogExitDiagnostics.ps1`：显式传入 `-OtterExe` 和新的
  `-OutputRoot`，验证临时父进程返回 0、23 和模拟的 0xC0000005 状态。
  脚本启动真实子进程并清理其测试进程，不注入键盘；模拟状态不等于重现访问违规。

运行探针前核对脚本和候选身份，使用独立测试输出目录。完整桌面启动、单实例、
退出和重启验证遵循[开发与验证](../guide/development.zh-CN.md)，不能由该 watchdog
探针或源码测试替代。若新事件证据不足，应继续标记原因未知，不沿用旧事件结论。
