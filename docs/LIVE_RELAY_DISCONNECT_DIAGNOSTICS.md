# 限定验收：观看端断开诊断

Issue #67 的 `.32` raw 试验观察到两次成功重连，但恢复后错误状态被清除，
原 runtime log 没有保存断开原因。内部迭代 `.33` 仅补充取证，不修改传输策略。

## 开关与记录边界

- 仅 viewer worker 启动时 `HOOK_NATIVE_ACCEPTANCE` 已启用才记录。
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

## 已做验证与未做验证

`cargo test --locked --manifest-path src-tauri/Cargo.toml live_relay --lib`：
62 项通过、4 项按原定义 ignored。其中新增 6 项验证开关、32 条预算、锁竞争不等待、
IO 原始错误文本不泄漏、Close code 与 stop 独立，以及 WriteBufferFull 不输出 payload。
相关正常策略 Close、终态设备关闭和 source worker 生命周期测试继续通过。

已运行 Rust 格式检查、Hook 行数门禁及 `git diff --check`。这些是软件验证，
尚未证明 `.33` 在 PC1/PC3 的实际故障中取得了原因，也没有完成新的 JPEG/raw 配对。
发布候选须另记录构建 SHA 和 self-check；本迭代不是正式公共 release。
