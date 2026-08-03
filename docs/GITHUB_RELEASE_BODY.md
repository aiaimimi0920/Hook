## Hook V0.1.7

This release summarizes changes since **V0.1.5**. V0.1.6 is intentionally not
used as the changelog baseline.

### Added

- Added HDR-aware screenshots with automatic SDR fallback.
- Added hovered-window targeting and double-click window capture.
- Added unified image naming rules for save, clipboard, and drag export.
- Added a compact searchable Art selector and expanded Loom Art integration.

### Improved

- Improved sticker dragging, annotation movement, minify/restore, wheel controls,
  and shader preview responsiveness.
- Improved crop, export sizing, session restoration, cache lifetime, and long-run
  memory stability.
- Improved release verification, signing provenance, and project documentation.

### Fixed

- Fixed focus and shortcut conflicts after capture, including Alt key passthrough.
- Fixed sticker drag detachment, delayed overlay panels, and hidden fullscreen
  stickers intercepting input.
- Fixed emergency exit reliability and cursor restoration after abnormal exits.
- Fixed Art parameter/image propagation and asynchronous preview update issues.

### 主要更新

#### 新增

- 新增 HDR 截图，并在不支持时自动降级为 SDR。
- 新增窗口悬停识别与双击窗口截图。
- 新增保存、剪贴板和拖出文件的统一图片命名规则。
- 新增紧凑可搜索的 Art 选择器，并扩展 Loom Art 联动能力。

#### 完善

- 提升贴图拖动、标注移动、缩小/恢复、滚轮操作和 Shader 预览响应速度。
- 完善裁剪、导出尺寸、会话恢复、缓存生命周期和长时间运行内存稳定性。
- 完善版本验证、签名来源校验和项目文档。

#### 修复

- 修复截图后的焦点与快捷键冲突，包括 Alt 键传递问题。
- 修复贴图快速拖动脱手、浮动面板延迟，以及全屏遮挡后仍拦截输入的问题。
- 修复紧急退出可靠性和异常退出后的鼠标指针恢复。
- 修复 Art 参数、图片输入传递和异步预览更新问题。

**Full Changelog**: [V0.1.5...V0.1.7](https://github.com/aiaimimi0920/Hook/compare/V0.1.5...V0.1.7)

### Package notes

The portable archive is the current user-facing package. Extract it and run
`hook.exe`. The attached signing-candidate JSON is provenance metadata, not an
installer.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/), applies only after the Hook
project is provisioned and the hosted signing request receives manual approval.

- [UIAccess distribution notes](https://github.com/aiaimimi0920/Hook/blob/main/UIACCESS_DISTRIBUTION.md)
- [Code signing policy](https://github.com/aiaimimi0920/Hook/blob/main/docs/CODE_SIGNING_POLICY.md)
- [Privacy policy](https://github.com/aiaimimi0920/Hook/blob/main/docs/PRIVACY_POLICY.md)
- [Security policy](https://github.com/aiaimimi0920/Hook/blob/main/SECURITY.md)
