# 限定验收：观看端断开诊断

此诊断为受控原生验收保留观看端断开证据，避免重连恢复清除错误状态后失去线索。
它只补充取证，不修改传输策略；相关计时和候选身份规则见
[LiveRelay diagnostics](LIVE_RELAY_DIAGNOSTICS.md)。

## 开关与记录边界

- 仅 viewer worker 启动时 `OTTER_NATIVE_ACCEPTANCE` 已启用才记录；旧
  `HOOK_NATIVE_ACCEPTANCE` 仅作回退，见[环境变量优先级](../development/RENAMING.md#环境变量)。
- 每个 viewer worker 生命周期最多尝试写入 32 条；重连不会重置预算。
- 事件名为 `live_relay_viewer_disconnect`，记录 stop、显式 reconnect、Ping/Pong
  发送失败、读取失败、帧/消息校验失败或对端 Close。
- Socket 错误只记录固定类别；IO 附带 ErrorKind 与可选 OS error number。
  Close 只记录数字 code，不记录 peer reason、原始错误文本、payload、URL 或凭据。
- 附带单连接存续毫秒数、可选 `(epoch, frame_id, reconnect_count)`、停止标志和
  剩余预算。state 使用 `try_lock`；忙或 poisoned 时记录 None，不等待锁后再清理。
- 沿用现有日志等级和容量 512 的非阻塞队列。info 被过滤、队列满或落盘失败可能丢失，
  不是可靠审计账本；没有事件不能证明没有断开。用单观看端的专用进程日志绑定证据，
  不把缺少 relay identity 的事件用于多观看端逐会话归因。

普通读超时、Ping 到期、重连等待、授权处理和 socket 关闭策略均不改变。
默认日常运行不启用该诊断。不把错误分类当作网络、代理或接收端瓶颈的根因证明。

## 验证入口与证据边界

在仓库根运行 `cargo test --locked --manifest-path src-tauri/Cargo.toml live_relay --lib`，
关注开关、32 条预算、锁竞争不等待、原始错误与 payload 不泄漏，以及既有 Close、
终态设备关闭和 worker 清理合同。默认 ignored 的原生项需要单独安排，不能计为通过。

软件测试不证明真实故障已取得原因，也不替代 JPEG/raw 配对或网络验收。
原生证据须绑定实际构建 SHA、进程身份、专用日志与现场时间；历史计数和候选回执
保留在 Git 历史，不作为当前版本的通过声明。
