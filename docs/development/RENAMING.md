# Otter 更名与兼容约定

产品英文名为 **Otter**，中文名为 **水獭**，原名为 Hook。
更名关联 [Issue #77](https://github.com/aiaimimi0920/Otter/issues/77)。

## 当前源码与后续构建

- GitHub 仓库：`https://github.com/aiaimimi0920/Otter`。
- Neuro 子模块目录：`Otter/`。
- 当前源码的可执行文件名：`otter.exe`。
- 启动入口：`start-otter.bat`、`start-otter.vbs`。
- 新构建使用 Otter 产品名称；更名不代表已经发布新的公开版本。

历史 Git 提交、标签、Release 附件和本地已编译包不重写。
旧版本仍可能包含 `hook.exe`，按对应发布页的真实附件和说明使用，
不要将旧版本下载地址中的文件名机械替换为 `otter.exe`。

## 保留稳定身份

产品名不是数据迁移开关。以下名称继续保留，用于读取原有数据、保持
已发布协议兼容，以及防止旧 Hook 和 Otter 同时操作同一会话：

- Tauri 应用标识 `com.yamiyu.hook`。
- 单实例及贴图互斥标识 `ArtNexus.Hook.*`。
- 已有 IndexedDB/localStorage 键、会话字段和迁移标记。
- `Hook/clipboard_cache` 磁盘目录及其受限图片读取范围。
- `loom.hook.v1` 和 `loom.hook.*` 协议方法、事件与序列化标签。
- `/v1/hook-bridge`、`/v1/intake/hook`、`hook-live` 等已有接口标识。
- 已发布扩展权限、能力字段以及持久化应用 ID `hook`。

这些保留项不应作为遗漏继续全局替换。Windows 输入 hooks、前端 hooks、
Rust panic hooks 和 Loom 工作流生命周期 hooks 是技术术语，也不属于产品更名。

内部源码组织和宿主私有事件不属于上述兼容身份：Loom 的画布组件目录、
API 客户端文件和缓存实现模块使用 `otter` 命名；Otter 内部样式使用
`otter-panel-*`，宿主私有 DOM 事件使用 `otter:*`。发送端和监听端必须同步修改，
但不改写对外 Surface 协议、设备地址和投射邀请中的旧标识。

混合当前设计与历史验收的文档只更新当前规则；带日期的检查点、旧源码定位、
历史包路径、摘要和已执行验收记录保持原样，不将旧 Hook 验收改称 Otter 验收。

## 环境变量

原生运行时对品牌环境变量优先读取新名称，并兼容旧名称：

- `HOOK_*` 对应 `OTTER_*`。
- `LOOM_HOOK_*` 对应 `LOOM_OTTER_*`。
- 如 `HOOK_ENABLE_LOOM_HOOK` 对应 `OTTER_ENABLE_LOOM_OTTER`。

新变量存在时优先，即使值为空也不回退到旧值，以免意外启用旧配置或凭据。
变量值是否有效仍由各配置项原有校验负责。构建脚本和外部签名服务的参数
遵循各自接口，不因产品更名推定第三方已同步更新。
