# Hook 项目概览

Hook 是 ArtNexus 生态系统中的 **Overlay (覆盖层)** 组件，基于 Tauri (Rust + SolidJS) 构建。它提供了一个始终置顶的透明窗口，允许用户在屏幕任意位置进行截图、图像排列、以及基于节点的图像处理工作流。

## 1. 核心应用场景

*   **屏幕截图与标注**: 快速捕获屏幕区域，生成“贴纸 (Sticker)”节点，进行标注和整理。
*   **节点式图像处理**: 通过连接不同的处理节点 (Art Node)，构建图像处理管线（例如：截图 -> 滤镜 -> AI 处理 -> 结果）。
*   **视觉思维整理**: 像白板一样自由拖拽、缩放、排列图像素材。

## 2. 目录结构说明

```
Hook/
├── src/
│   ├── app.tsx                 # 核心应用逻辑 (状态管理, 全局快捷键, 事件监听)
│   ├── components/             # UI 组件
│   │   └── UnitView.tsx        # 核心组件: 渲染单个节点 (图像/参数/端口)
│   ├── services/               # 业务服务层
│   │   ├── client.ts           # 与 ArtLoom (编辑器) 的通信客户端
│   │   ├── protocol.ts         # 通信协议定义 (ArtCapability, Transport)
│   │   └── shaderCache.ts      # WebGL Shader 缓存管理
│   ├── types/                  # TypeScript 类型定义
│   │   ├── unit.ts             # 节点 (Unit) 与 连接 (Link) 的数据结构
│   │   └── graph.ts            # 图相关类型
│   └── hooks/                  # 自定义 Hooks (如 shortcuts)
├── src-tauri/                  # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── main.rs             # 入口
│   │   └── mock_artloom.rs     # 模拟后端逻辑 (在无 Python 后端时使用)
│   └── tauri.conf.json         # Tauri 配置 (窗口透明, 权限等)
└── package.json
```

## 3. 核心逻辑与架构

### 3.1 数据模型 (Unit & Link)
Hook 的核心数据结构是 **Unit (单元)** 和 **Link (连接)**：
*   **Unit**: 代表画布上的一个节点。
    *   `type`: 'sticker' (静态图片) 或 'art' (处理节点)。
    *   `data`: 存储图片数据 (Base64/Path)、裁剪信息、UI状态。
    *   `params`: 存储该节点的参数值。
*   **Link**: 代表节点间的数据流向 (Source Unit -> Target Unit)。

### 3.2 交互逻辑
*   **全局画布**: `App.tsx` 维护 `units` 和 `links` 的全局状态 (SolidJS Store)。
*   **快捷键**:
    *   `Tab`: 切换选中节点的 **属性面板 (Parameter Panel)**。
    *   `Shift`: 切换选中节点的 **操作菜单 (Actions Menu)**。
    *   `Ctrl + C/V`: 剪贴板操作 (支持跨应用复制)。
    *   `Delete`: 删除节点。
*   **拖拽交互**:
    *   文件拖入: 创建新节点或替换现有节点图片。
    *   连线: 从节点右侧 **输出点 (Output Dot)** 拖拽至另一节点左侧 **输入点 (Input Dot)**。

### 3.3 通信 (ArtProtocol)
Hook 不仅是一个画板，还是 ArtLoom 的运行时前端。
*   通过 `services/client.ts` 与 Python 后端或 ArtLoom 编辑器通信。
*   支持 **Shared Memory (共享内存)** 高速传输大图像数据。
*   接收后端推送的 `ArtCapability` (节点定义) 来动态生成 UI 输入控件。

## 4. UI 设计规范
*   **视觉风格**: Glassmorphism (毛玻璃), 深色模式。
*   **节点外观**:
    *   **端口 (Dots)**: 颜色代表数据类型 (Type-based Coloring)。
        *   **Image (图片)**: <span style="color:SpringGreen">● Green (Emerald)</span>
        *   **File (文件)**: <span style="color:DeepSkyBlue">● Blue</span>
        *   **Text (文本)**: <span style="color:Orange">● Amber</span>
        *   **Number (数值)**: <span style="color:Violet">● Violet</span>
    *   Tab 键呼出下方悬浮属性面板。
