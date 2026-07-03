# Hook

<p align="center">
  <img src="docs/assets/github-home-hero.svg" alt="Hook GitHub hero" width="100%" />
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  面向 Windows 的开源桌面截图、贴图编辑与视觉工作流工作台。
</p>

<p align="center">
  维护方：<strong>yamiyu</strong>
</p>

<p align="center">
  <a href="https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml"><img src="https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml/badge.svg" alt="Build Hook EXE" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Windows" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/SolidJS-TypeScript-2C4F7C" alt="SolidJS TypeScript" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F4EA2A" alt="MIT License" /></a>
</p>

Hook 不只是一个“截完图就结束”的工具。它把下面几件事组合到了一起：

- 快速截图与长截图
- 贴图式视觉整理与标注
- 节点式桌面画布工作区
- Talk / Loom / Tea 等本地能力桥接

它适合用作：

- 轻量截图工作台
- 贴图白板
- 桌面视觉批注工具
- 本地 AI / 工作流前端

## 目录

- [为什么是 Hook](#为什么是-hook)
- [核心能力](#核心能力)
- [桌面模式](#桌面模式)
- [下载与体验](#下载与体验)
- [快速开始](#快速开始)
- [本地构建 EXE](#本地构建-exe)
- [文档入口](#文档入口)
- [开源身份与兼容性](#开源身份与兼容性)
- [开发与验证](#开发与验证)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 为什么是 Hook

Hook 关注的是截图工具和更重型设计工具之间的那段空白：

- 截图之后还可以继续直接编辑和组织
- 贴图、标注、引用图可以沉淀在同一个桌面工作区
- 回收站和参考库让素材可反复利用
- 节点画布和本地能力桥接让它不只是“图片收集器”

## 核心能力

- **截图与长截图**
  - 区域截图
  - 纵向 / 横向长截图会话
  - 面向桌面性能的文件型截图载荷
- **贴图与标注工作区**
  - 裁剪、边框、透明度、光栅效果、取色复制
  - 文本、编号、图形、画笔、高亮
  - 回收站与参考列表
- **桌面工作流画布**
  - 节点图、连线、分组参数、同步入口
  - 面向编辑的顶部工具栏与上下文菜单
  - 本地启动辅助与单实例控制
- **本地能力桥接**
  - Talk 语音捕获桥接
  - Loom 规划 / 能力桥接
  - Tea 任务 intake 桥接

## 桌面模式

| 模式 | 作用 |
| --- | --- |
| Overlay | 透明置顶的截图与贴图表面 |
| Canvas | 聚焦编辑与工作流的主工作区 |
| Tray | 常驻后台并通过托盘重新进入 |

## 下载与体验

### 方式 A：GitHub Actions 构建产物

仓库会通过 GitHub Actions 自动构建 Windows EXE：

- 工作流：<https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml>
- 产物名称：`hook-windows-x64`

这是当前体验最新仓库版本最直接的方式。

### 方式 B：Releases

如果后续发布正式版本，请查看：

- <https://github.com/aiaimimi0920/Hook/releases>

### 当前包体形态

当前公开发布目标是 **minimal EXE 包体**。

## 快速开始

推荐本地环境：

- Windows
- Node.js 20+
- npm
- Rust stable toolchain

安装依赖：

```bash
npm install
```

启动桌面开发壳：

```bash
npm run dev:tauri
```

补充说明：

- `npm run dev:tauri` 是主桌面开发入口
- `npm run dev` 适合前端单独联调
- `npm run build && npm run serve:static` 适合静态浏览器预览

## 本地构建 EXE

推荐构建命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-local-hook-exe.ps1 -Force
```

默认输出：

```text
..\release\Hook\hook.exe
```

当前仍保留兼容包装脚本：

- `build-hook-release.bat`
- `package-hook-release.ps1`

它们最终都会委托到 Hook 项目内部的标准构建流程。

## 文档入口

### 当前有效文档

如果你要理解当前真实代码，以这些文件为准：

- `README.md`
- `README.zh-CN.md`
- `PROJECT_OVERVIEW.md`
- `TECHNICAL_ARCHITECTURE.md`

### 历史归档文档

迁移记录、阶段计划、历史设计留档位于：

- `docs/migration/*`
- `docs/superpowers/plans/*`
- `docs/superpowers/specs/*`

如果历史文档和当前实现冲突，以根目录当前文档为准。

## 开源身份与兼容性

- 当前公开 Tauri 标识为：`com.yamiyu.hook`
- 对用户可见的运行名仍保持为：`Hook` / `hook.exe`
- 本地剪贴板缓存仍位于：`LOCALAPPDATA/Hook/...`
- 为避免旧安装数据丢失，Hook 会兼容历史本地目录：
  - `io.github.aiaimimi0920.hook`
  - `com.vmjcv.hook`
- 当前公开仓库地址仍然使用真实 GitHub 地址：
  - <https://github.com/aiaimimi0920/Hook>

## 开发与验证

常用验证命令：

```bash
npm run typecheck
npm run test
npm run verify:local
```

`npm run verify:local` 是主本地验证入口，会依次执行：

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. `build-hook-release.bat`

## 参与贡献

欢迎提交 issue、构建反馈和聚焦型改进建议：

- Issues：<https://github.com/aiaimimi0920/Hook/issues>
- Actions：<https://github.com/aiaimimi0920/Hook/actions>

参与开发时，优先参考根目录当前文档，而不是 `docs/` 下的历史规划材料。

## 许可证

MIT
