# Hook 项目概览

Hook 是一个基于 **Tauri + SolidJS** 的 Windows 桌面截图、贴图编辑与节点画布工具。它当前更适合被理解为：

- 一个覆盖层/画布一体化的桌面应用
- 一个带本地工作流联动能力的贴图与标注工具
- 一个支持本地能力桥接（Talk / Loom / Tea）的操作前端

## 1. 主要场景

- **区域截图 / 长截图**
- **贴图整理与标注**
- **节点式图像处理与结果回写**
- **桌面视觉工作台**

## 2. 当前仓库关注点

这个仓库当前主要维护三类内容：

1. **前端 UI 与交互**
   - 贴图编辑
   - 上下文菜单
   - 标注层
   - 参数面板
   - 历史记录与回收站

2. **桌面后端能力**
   - 截图
   - 长截图拼接
   - 剪贴板与文件对话框
   - 全局快捷键
   - 本地单实例控制

3. **本地构建与发布**
   - 本地 exe 生成
   - GitHub Actions 自动构建
   - 最小发布包产物

## 3. 目录结构

```text
Hook/
├── src/                        # 前端主代码
│   ├── app.tsx                 # 主控制器
│   ├── components/             # UI 组件
│   ├── hooks/                  # 前端交互 hooks
│   ├── services/               # typed API、同步、贴图编辑逻辑
│   ├── store/                  # 图状态 / UI 状态
│   └── types/                  # TS 类型
├── src-tauri/                  # Rust / Tauri 后端
│   ├── src/                    # capture / voice / connectors / workflow bridge
│   ├── crates/                 # Hook 自持 capture crates
│   └── tauri.conf.json
├── scripts/                    # 本地开发与构建脚本
├── __tests__/                  # 契约测试 / 单元测试
├── .github/workflows/          # CI 构建工作流
└── docs/                       # 历史计划、迁移留档、设计文档
```

## 4. 当前开发入口

常用命令：

```bash
npm install
npm run dev:tauri
npm run test
npm run typecheck
npm run verify:local
```

本地构建 exe：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-local-hook-exe.ps1 -Force
```

默认产物输出到：

```text
..\release\Hook\hook.exe
```

## 5. 当前文档边界

如果需要了解“当前怎么开发、怎么构建、怎么运行”，优先看：

- `README.md`
- `TECHNICAL_ARCHITECTURE.md`
- `PROJECT_OVERVIEW.md`

如果需要追溯历史阶段性设计与迁移背景，再看：

- `docs/superpowers/plans`
- `docs/superpowers/specs`
- `docs/migration`
