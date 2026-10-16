# Otter 代码组织与开发规范

本文件面向开发者和 AI 协作者，是文件归属、模块导航和结构变更的长期规范，
不是一次迁移的执行日志。工程流程见 [CONTRIBUTING](../../CONTRIBUTING.md)，
运行时设计见 [技术架构](../architecture/overview.md)。

## 1. 从哪里开始

1. 阅读根目录 `README.md`、`AGENTS.md`、`CONTRIBUTING.md`。
2. 按下面的功能地图找到 owner，再读实现、调用点和对应测试。
3. 先确认当前工作区差异与基线，不覆盖其他人的修改。
4. 修改已有功能时沿用已有状态和生命周期 owner，不创建第二套实现。
5. 提交前更新受影响的导航、检查路径、执行匹配验证，并说明未验证范围。

## 2. 根目录放什么

| 位置 | 职责 |
| --- | --- |
| `README.md`、`README.zh-CN.md` | 项目介绍和用户/贡献者入口 |
| `AGENTS.md`、`CONTRIBUTING.md` | AI 与人工协作的强制规则、贡献流程 |
| `LICENSE`、`THIRD_PARTY_NOTICES.md`、`SECURITY.md`、`GOVERNANCE.md` | 许可、安全报告和项目治理 |
| `package.json`、锁文件、`tsconfig*.json`、`vite.config.ts`、`eslint.config.js`、`postcss.config.js`、`index.html` | 工具链约定入口；不为视觉整洁搬入通用 `config/` |
| `version-state.json` | 内部构建身份，不替代 npm/Cargo/Tauri 的三段版本 |
| 现有启动、停止和打包包装脚本 | 保留用户及自动化的稳定入口；内部逻辑放 `scripts/` |
| `src/`、`src-tauri/` | 前端与原生工程，保留现有构建边界 |
| `tests/`、`scripts/`、`docs/` | 前端验证、工程工具、分主题文档 |
| `public/`、`protocol/`、`security/`、`.github/` | 随应用分发的静态资源、协议夹具、安全配置、GitHub 自动化 |

不把运行日志、截图证据、依赖目录、测试输出、临时计划或用户数据加入源码。
文档图片放 `docs/assets/`；应用图标继续由 `src-tauri/icons/` 管理。
新增根目录文件必须具有项目级入口或工具发现理由，而不只是暂时不知道放哪里。

## 3. 前端功能地图

| 目录 | 职责与常用入口 |
| --- | --- |
| `src/main.tsx` | 按启动模式加载桌面或 Tile；保持 Tile 不初始化桌面监听器 |
| `src/app/` | 应用组合、启动、跨功能事件协调；入口 `app.tsx` |
| `src/features/workspace/` | 画布、Unit、图、选择、拖动、会话与工作流持久化；`state/graphStore.ts`、`state/uiStore.ts` |
| `src/features/stickers/` | 贴图编辑、标注、工具条、几何、历史、导出；`components/StickerAnnotationLayer.tsx` |
| `src/features/capture/` | 区域/窗口/长截图的前端交互；`hooks/useSelection.ts` |
| `src/features/live/` | 实时捕获与 relay 的呈现、状态、输入与生命周期 |
| `src/features/projection/` | 二维码邀请、设备投送、接收策略、双向编辑、绑定与 journal |
| `src/features/art/` | Art 能力、节点参数、端口、OCR 呈现与 shader 预览 |
| `src/features/surfaces/` | 声明式/JavaScript Surface 宿主、资源与确认界面 |
| `src/features/extensions/` | 插件贡献、菜单、快捷键、bridge 与权限快照 |
| `src/features/tile/` | 独立显示终端、墙面协议、呈现与输入控制；`components/TileTerminal.tsx` |
| `src/features/settings/` | 应用/工具设置、文件命名、字体与启动配置模型 |
| `src/platform/tauri/` | invoke、命令客户端、浏览器 fallback 与本地图片 URL 适配；稳定门面 `api.ts` |
| `src/platform/desktop/` | 桌面输入、交互区域、焦点、快捷键与诊断边界 |
| `src/integrations/loom/`、`tea/` | Otter 侧连接与契约适配，不复制外部产品内部代码 |
| `src/shared/` | 无业务状态的 async、diagnostics、geometry、images 和全局样式原语 |

功能目录内按需要使用 `components/`、`hooks/`、`services/`、`state/`、
`types/`、`styles/`、`model/`，不为了模板创建空目录。
组件及其专属 CSS 可以相邻；领域类型跟随功能，不汇总到全局类型大文件。
例如修改投送接收 UI，先看 `features/projection/components/`，再看同目录树中的
`state/` 和 `services/`，测试从 `tests/unit/`、`tests/integration/` 按功能名定位。

## 4. 依赖与状态边界

- 目录表达职责，不宣称本次迁移已经消除了历史跨功能耦合。
- `app/` 负责组合。领域算法不要继续堆入应用入口。
- `shared/` 不依赖 `features/`、`app/`、`platform/` 或 `integrations/`。
  一个 UI 即使被多个功能使用，只要依赖工作区状态，就仍属于工作区，不能假装是纯通用组件。
- 外部服务通过 Otter 的 client/协议适配接入；不得复制 Loom、Talk、Tea 等仓库的实现。
- 功能间使用明确的现有接口；新增依赖不得引入运行时循环，也不要创建汇总所有模块的 `index.ts`。
- 不以文件迁移为理由引入全局 service locator、事件总线、第二份 store 或额外 package。
- 保留 `graphStore.actions` 的持久化写入口；高频指针预览不得直接写入持久化图。
- 移动 store、cache、监听器或 controller 时，必须保持实例数量、初始化时机、清理与取消语义。
- 延迟加载、Worker、CSS、字体、Tauri 命令字符串、协议字段和应用数据路径不是普通 import；逐项检查。

## 5. Rust 与原生目录

`src-tauri` 保留 Cargo、Tauri、build.rs、icons、capabilities、windows 和本地 crates 的位置。
现有 `screenshot`、`loom_connection`、`live_gpu`、`live_resources`、`voice` 等模块继续拥有自己的目录。

`src-tauri/src/native/` 按应用接线职责分为：

- `runtime/`：启动、日志、托盘与应用生命周期。
- `capture/`、`long_capture/`：截图命令和长截图编排，不与独立算法模块混为一谈。
- `input/`、`overlay/`：输入队列、hook、光标和 overlay 窗口/遮挡/交互路由。
- `session/`、`image_io/`：会话持久化与图片、剪贴板、拖放边界。
- `live/capture/`、`live/source/`、`live/relay/`、`live/observation/`：实时会话职责。
- `tests/`：现有 native 夹具与合同测试，保留各自 include 入口。

重要：这些文件中有许多由 `lib.rs` 的 `include!` 接入 crate 根作用域，
并非同名 Rust module。不得把 `include!` 顺手改成 `mod`，否则会改变私有项可见性、
宏展开和命令路径。需要这种重构时，应单独设计并证明行为不变。
移动 Rust 文件要检查 `include!`、`include_str!`、`include_bytes!`、`#[path]` 和调用方。
本地第三方 crate 的许可证、来源和锁文件必须随其 owner 保留，不借整理目录修改供应链。

## 6. 测试、脚本和文档

`tests/` 保留 Vitest 的 `unit/`、`integration/`、`performance/`、`fixtures/`、
`helpers/`、`setup/` 分组。`integration/` 同时包含源码合同与运行时测试，二者不能混称。
`scripts/tests/` 使用不同 runner 并包含真实环境探针，不并入 Vitest 默认收集。
Rust 集成测试仍在 `src-tauri/tests/`，模块单元测试留在所属模块。

`scripts/` 的现有顶层命令是稳定工具入口；现有 `release/`、`security/`、浏览器与
native 子目录放内部实现。新工具先明确用途、runner、输入/输出、副作用和退出码；
不要为一次任务增加永久 wrapper。修改脚本位置时检查 `$PSScriptRoot`、`%~dp0`、
`import.meta.url` 和 `__file__` 的根目录推导，不能只改调用命令。

文档目录按阅读目的划分：`guide/` 用户与开发上手，`architecture/` 当前设计，
`features/` 功能契约，`development/` 工程规范，`release/` 发布，`security/` 安全。
详细文档从 `docs/README.md` 导航；根目录保留 GitHub 可发现的贡献、安全和许可入口。
迁移文档要同时更新相对链接、脚本读取路径和 CI 的 docs-only 分类规则。
历史基线清单绑定历史提交，不得机械改写其路径或 hash。

文档清理应同时核对内容与引用，而非仅移动文件：

- 每项当前规则保留一个权威维护位置，其他入口链接过去；双语用户与开发指南同步。
- 以当前实现和 workflow 修正路径、参数、功能与产物说明；源码接入不等于原生验收通过。
- 已完成任务的逐轮日志、临时机器地址、测试计数和候选哈希留在 Git 历史，
  当前文档保留可重跑步骤、安全边界、未验证限制及必要历史证据定位。
- 保留仍在使用的兼容标识和未闭环限制；外部仓库的实现/部署状态不能由 Otter 单方面认证。
- 合并或删除文档前检查导航、测试、脚本和 CI 消费者；更新合同测试而不是恢复过期文案。

## 7. 变更与验证标准

- 源码、注释、文档和配置使用 UTF-8 无 BOM。保留现有命名，不在搬目录时批量改符号。
- 目标约 150 有效行，优先 100–250；251–500 需单一职责；501–700 需例外理由与保护测试。
  新增或完整迁移文件不得超过 700；完整规则以根 `AGENTS.md` 和官方计数器为准。
- 修改前测量并跑针对性基线；迁移优先整文件移动，只修改必要的路径和模块接线。
- 迁移与业务变化分批审查。不得通过删测试、改预期行为、减覆盖或放宽阈值掩盖回归。
- 检查类型、lint、相关测试、Rust formatter 和有效行数；最后运行 `git diff --check`。
- 功能迁移完成后运行完整前端测试、独立性能组、Rust 测试、静态构建与适用的浏览器门。
- 静态构建会清理其输出目录；打包、原生探针、真实服务连接具有副作用，先确认输出与环境。
- 保留稳定 npm 命令名。内部迭代只递增 `version-state.json`，不改变公开版本或应用身份。
- 分别报告代码检查、浏览器检查、原生运行、打包和人工验收；已有失败不等于新回归，未跑不等于通过。

当前命令和发布门见 [工程验证要求](ENGINEERING.md#6-tests-and-verification) 与
[发布来源规范](../release/release-provenance.md)。本文件不重复维护另一套命令清单。

## 8. 目录设计参考

参考的是职责表达方式，不是第三方实现。Piik 将工程入口与领域目录分开；Cap 保留桌面应用的
`src/` 和 `src-tauri/`；ShareX 按截图、编辑、历史等职责组织代码。Otter 不因此引入多应用 monorepo。

- [Piik 工程边界](https://github.com/TNTcraftHIM/Piik/blob/main/docs/standards/engineering.md)
- [Cap 桌面工程](https://github.com/CapSoftware/Cap/tree/main/apps/desktop)
- [ShareX 仓库](https://github.com/ShareX/ShareX)
