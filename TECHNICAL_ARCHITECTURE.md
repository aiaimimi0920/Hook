# Hook Technical Architecture

## 1. Overview
Hook is a desktop-based visual workflow automation tool ("ArtNexus") built on **Tauri v2**. It enables users to create, connect, and execute "ArtNodes" (functional units) on an infinite canvas. It features advanced capabilities like screen capture, OCR, and CLI tool integration, all orchestrated through a local Rust backend.

## 2. Technology Stack

### Frontend
- **Framework**: [SolidJS](https://www.solidjs.com/) (Reactive, high-performance)
- **Styling**: TailwindCSS + Manual CSS Variables (Theming/Glassmorphism)
- **State Management**: SolidJS `createStore` (Deep reactivity)
- **Build Tool**: Vite (Vinxi)

### Backend
- **Core**: Rust (Tauri v2)
- **IPC**: Tauri Command System + WebSocket (Port 19820)
- **Key Crates**:
  - `tauri`: Window & System integration
  - `tokio`: Async runtime
  - `screenshots`: Cross-platform screen capture
  - `image`: Image processing
  - `rapidocr`: OCR functionality

## 3. Core Architecture

### 3.1 Backend Services (`src-tauri/src`)
The Rust backend is modularized into specialized services:

- **`mock_artloom.rs`**: The brain of the operation.
  - Manages the `Workflow` state (Nodes, Links).
  - Handles execution flow (`propagate_signal`, `execute_node`).
  - Simulates the "ArtLoom" protocol for node discovery.
- **`cli_engine.rs`**: Specialized executor for CLI-based ArtNodes.
  - Wraps external binaries.
  - Handles `stdin`/`stdout` streaming and parameter substitution.
- **`ocr_service.rs`**: On-demand OCR processing.
  - Uses `RapidOCR` model.
  - Processing pipeline: Abstract -> Screenshot -> OCR -> Text.
- **`capture.rs` / `screenshot.rs`**: Native screen capture handling.

### 3.2 Frontend Architecture (`src`)
The frontend is a Single Page Application (SPA) driven by a central canvas.

- **`App.tsx`**: The main controller (Monolithic State Manager).
  - Manages `units` (ArtNodes), `links`, and `selection`.
  - Handles global events (Keyboard shortcuts, Drag & Drop).
  - Syncs state with Backend via Tauri Commands (`sync_workflow`).
- **`UnitView.tsx`**: The visual representation of a node.
  - **Portal-based UI**: Actions menus and overlapping elements use `<Portal>` to escape clipping.
  - **Ports**: Visual anchors for linking.
  - **Parameters**: Dynamic form generation based on ArtNode specs.
- **`artloom_client.ts`**: API Layer.
  - Abstracts WebSocket/IPC communication with the backend.

### 3.3 Data Flow
1.  **User Action**: User adds a node (Shift Key) or connects ports.
2.  **Frontend State**: `App.tsx` updates local store (`setUnits`, `setLinks`).
3.  **Sync**: `createEffect` triggers `update_backend_rects` or `sync_workflow`.
4.  **Execution**: Backend processes the graph, executes logic (CLI/OCR), and pushes results back via Events (`trigger-capture`, `ocr-result`).

## 4. Key Features & Implementation Details

- **Shift Trigger System**:
  - Refined Event Listener in `App.tsx` (`handleGlobalKeyDown`).
  - Single-source-of-truth for "Add Node" panel visibility.
  - Uses `Portal` for z-index management.
- **Glassmorphism UI**:
  - Custom CSS system (`app.css`) with manual polyfills for transparency and blur effects.
  - "Premium" aesthetic with dark transparencies and lavender accents.
- **CLI Integration**:
  - Safe execution wrapper preventing zombie processes via Rust's `Command` API.

## 5. Project Structure

```
Hook/
├── src/                  # Frontend Source
│   ├── app.tsx           # Main Canvas & State Logic
│   ├── app.css           # Global Styles & Polyfills
│   ├── components/       # UI Components
│   │   └── UnitView.tsx  # Node Visual Component
│   ├── services/         # API & Logic Services
│   └── lib/              # Utilities
├── src-tauri/            # Backend Source
│   ├── src/
│   │   ├── lib.rs        # Tauri Entry Point
│   │   ├── mock_artloom.rs # Workflow Engine
│   │   └── ...           # Service modules
│   └── tauri.conf.json   # App Configuration
└── ...
```

## 6. Stability & Optimization Status

### Stability
- **Verified**: The Shift Key trigger, Panel visibility, and Text colors have been rigorously debugged and fixed.
- **Robustness**: Event listeners now use strict cleanup (`onCleanup`) to prevent memory leaks or duplicate triggers.
- **Error Handling**: Solid Store updates are now guarded against `undefined` states.

### Areas for Future Improvement
- **Refactoring `App.tsx`**: Currently ~2900 lines. Breaking this into `Canvas.tsx`, `SelectionManager.tsx`, and `LinkLayer.tsx` would improve maintainability.
- **CSS Standardization**: Migrating fully to standard Tailwind config instead of `app.css` polyfills would reduce confusion.
