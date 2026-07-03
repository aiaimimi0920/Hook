# Hook 代码修改规范

本文档概述了修改 Hook 代码库的标准实践。遵守这些规范有助于保持代码的可维护性和一致性。

## 1. 样式与视觉 (Styling)
**核心策略**: **Tailwind 优先 (Tailwind First)**。

| 修改类型 (Type) | 目标文件 (Location) | 方法 (Method) |
| :--- | :--- | :--- |
| **全局主题/配色** | `src/app.css` | 修改 **CSS 变量** (`:root { --primary: ... }`)。 |
| **组件布局/结构** | `src/components/*.tsx` | 直接使用 **Tailwind 工具类** (`flex`, `p-4`, `absolute`)。<br>**不要**在 `app.css` 中新建业务类名。 |
| **动态样式/高频变化** | `src/components/*.tsx` | 使用 **内联样式** `style={{ ... }}`。<br>适用对象：坐标 (`left/top`)、透明度、拖拽时的实时偏移。 |
| **复杂动画** | `src/app.css` | 如果 Tailwind 的 `animate-` 不够用，可以在此定义 `@keyframes`。 |

## 2. 状态管理 (State Management)
**核心原则**: 持久化数据与临时 UI 状态分离。

| 状态类型 | 目标文件 | 说明 |
| :--- | :--- | :--- |
| **图数据 (Data)** | `src/store/graphStore.ts` | **持久化数据**。包含节点、连线、参数。这些数据会同步到后端或保存到磁盘。 |
| **UI 状态 (UI)** | `src/store/uiStore.ts` | **临时数据**。包含选中项、鼠标位置、连线状态、视图模式（Clean View）。 |
| **后端集成** | `src/services/` | `api.ts` (API 通信) 和 `syncService.ts` (空间位置同步) 的逻辑位置。 |

## 3. 逻辑与交互 (Logic)
**核心原则**: 通过 Hooks 进行封装。

| 逻辑类型 | 目标文件 | 说明 |
| :--- | :--- | :--- |
| **复用行为** | `src/hooks/` | 拖拽 (`useDraggable`)、剪贴板 (`useClipboard`)、框选 (`useSelection`)。 |
| **全局事件** | `src/app.tsx` | 窗口级监听器（全局快捷键、画布外的 MouseUp）。 |
| **节点行为** | `src/components/UnitView.tsx` | 节点的特定 DOM 事件（双击、缩放、端口交互）。 |

## 4. 关键文件映射 (Key Files)
*   **`src/app.tsx`**: 主入口。负责初始化监听器和整体布局结构。
*   **`src/components/UnitView.tsx`**: 画布的“原子”组件。负责渲染单个节点/Sticker。
*   **`src/services/uiRegistry.ts`**: **点击检测 (Hit-Testing)** 的核心。负责向 Rust 后端注册 UI 元素的矩形区域，防止点击穿透。
