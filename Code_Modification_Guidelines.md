# Hook Code Modification Guidelines

This document outlines the standard practices for modifying the Hook codebase. Adhering to these guidelines ensures maintainability and consistency.

## 1. Styling & Visuals (CSS/UI)
**Strategy**: **Tailwind First**.

| Modification Type | Target Location | Method |
| :--- | :--- | :--- |
| **Global Theme/Colors** | `src/app.css` | Edit CSS Variables (`:root { --primary: ... }`). |
| **Component Layout** | `src/components/*.tsx` | Use **Tailwind Utility Classes** (`flex`, `p-4`, `absolute`). <br>**Do not** start new CSS classes in `app.css`. |
| **Dynamic Values** | `src/components/*.tsx` | Use **Inline Styles** `style={{ ... }}`. <br>Target: Coordinates (`left/top`), Opacity, Drag Offsets. |
| **Complex Animations** | `src/app.css` | Define `@keyframes` here if Tailwind animate-utilities are insufficient. |

## 2. State Management (Store)
**Core Principle**: Separation of Persistent Data and Transient UI State.

| State Type | Target Location | Description |
| :--- | :--- | :--- |
| **Graph Data** | `src/store/graphStore.ts` | **Persistent**. Nodes, Links, Parameters. This data syncs to backend/disk. |
| **UI State** | `src/store/uiStore.ts` | **Transient**. Selection, Generic Mouse Position, Linking Status, View Modes. |
| **Backend Integration** | `src/services/` | Logic for `api.ts` (HTTP/WS) and `syncService.ts` (Spatial Sync). |

## 3. Logic & Interaction
**Core Principle**: Encapsulation via Hooks.

| Logic Type | Target Location | Description |
| :--- | :--- | :--- |
| **Reusable Behavior** | `src/hooks/` | Dragging (`useDraggable`), Copy/Paste (`useClipboard`), Selection (`useSelection`). |
| **Global Events** | `src/app.tsx` | Window-level listeners (Global Shortcuts, MouseUp outside canvas). |
| **Node Behavior** | `src/components/UnitView.tsx` | Specific DOM events for nodes (DoubleClick, Resize, Port interaction). |

## 4. Key Files Map
*   **`src/app.tsx`**: Main Entry. Initializes listeners and layout structure.
*   **`src/components/UnitView.tsx`**: The "Atom" of the canvas. Renders individual nodes/stickers.
*   **`src/services/uiRegistry.ts`**: Critical for HIT-TESTING. Registers UI element rects for the Rust backend to "see".
