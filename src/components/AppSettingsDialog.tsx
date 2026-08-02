import {
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from "solid-js";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../types/appSettings";
import {
    FILE_NAMING_PLACEHOLDERS,
    type FileNamingContext,
    type FileNamingSettings,
} from "../types/fileNaming";
import {
    normalizeAppSettings,
    saveCurrentAppSettings,
} from "../services/appSettings";
import {
    renderFileNamingStem,
    validateFileNamingPattern,
} from "../services/fileNaming";

interface Props {
    open: boolean;
    settings: AppSettings;
    onClose: () => void;
    onSaved: (settings: AppSettings) => void;
}

type PatternKey =
    | "stickerSavePattern"
    | "dragExportPattern"
    | "clipboardFilePattern";

const patternRows: Array<{ key: PatternKey; label: string; description: string }> = [
    {
        key: "stickerSavePattern",
        label: "贴图保存 / 另存为",
        description: "用于保存目录和原生另存为对话框的默认文件名。",
    },
    {
        key: "dragExportPattern",
        label: "拖出到 Explorer",
        description: "用于 Shift 拖出、原生文件拖动以及 Art 节点导出。",
    },
    {
        key: "clipboardFilePattern",
        label: "剪贴板文件",
        description: "用于 Explorer 粘贴时看到的贴图或 Art 文件名。",
    },
];

const previewContext: FileNamingContext = {
    app: "Hook",
    kind: "sticker",
    label: "图片压缩",
    title: "参考窗口 - 示例",
    process: "demo.exe",
    unitId: "unit-8f2a",
    shortId: "8f2a",
    width: 1920,
    height: 1080,
};

const cloneSettings = (settings: AppSettings): AppSettings => ({
    schemaVersion: settings.schemaVersion,
    fileNaming: { ...settings.fileNaming },
});

export const AppSettingsDialog: Component<Props> = (props) => {
    const [draft, setDraft] = createSignal<AppSettings>(cloneSettings(DEFAULT_APP_SETTINGS));
    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal<string | null>(null);

    createEffect(() => {
        if (!props.open) return;
        setDraft(cloneSettings(props.settings));
        setSaving(false);
        setSaveError(null);
    });

    const patternErrors = createMemo<Record<PatternKey, string | null>>(() => {
        const naming = draft().fileNaming;
        return {
            stickerSavePattern: validateFileNamingPattern(naming.stickerSavePattern),
            dragExportPattern: validateFileNamingPattern(naming.dragExportPattern),
            clipboardFilePattern: validateFileNamingPattern(naming.clipboardFilePattern),
        };
    });

    const hasErrors = createMemo(() =>
        Object.values(patternErrors()).some((error) => error !== null),
    );

    const updateNaming = <K extends keyof FileNamingSettings>(
        key: K,
        value: FileNamingSettings[K],
    ) => {
        setDraft((current) => ({
            ...current,
            fileNaming: {
                ...current.fileNaming,
                [key]: value,
            },
        }));
        setSaveError(null);
    };

    const previewFor = (key: PatternKey) =>
        `${renderFileNamingStem(
            draft().fileNaming[key],
            previewContext,
            draft().fileNaming,
        )}.png`;

    const handleSave = async () => {
        if (saving() || hasErrors()) return;
        setSaving(true);
        setSaveError(null);
        try {
            const saved = await saveCurrentAppSettings(normalizeAppSettings(draft()));
            props.onSaved(saved);
            props.onClose();
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    };

    onMount(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!props.open || event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            props.onClose();
        };
        window.addEventListener("keydown", handleKeyDown, true);
        onCleanup(() => window.removeEventListener("keydown", handleKeyDown, true));
    });

    return (
        <Show when={props.open}>
            <div
                class="hook-settings-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target === event.currentTarget) props.onClose();
                }}
            >
                <section
                    class="hook-terminal-shell hook-terminal-shell--strong hook-settings-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="hook-settings-title"
                    onMouseDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <header class="hook-settings-header">
                        <div>
                            <div class="hook-settings-kicker">HOOK / APP SETTINGS</div>
                            <h2 id="hook-settings-title">图片文件命名</h2>
                            <p>所有真实写盘操作由 Rust 后端统一清洗并原子分配冲突文件名。</p>
                        </div>
                        <button
                            type="button"
                            class="hook-terminal-btn hook-settings-close"
                            onClick={() => props.onClose()}
                            aria-label="关闭设置"
                        >
                            ×
                        </button>
                    </header>

                    <div class="hook-settings-content">
                        <For each={patternRows}>
                            {(row) => (
                                <label class="hook-settings-field">
                                    <span class="hook-settings-field-title">{row.label}</span>
                                    <span class="hook-settings-field-copy">{row.description}</span>
                                    <input
                                        class="hook-terminal-input hook-settings-pattern-input"
                                        value={draft().fileNaming[row.key]}
                                        spellcheck={false}
                                        onInput={(event) =>
                                            updateNaming(row.key, event.currentTarget.value)
                                        }
                                    />
                                    <Show when={patternErrors()[row.key]}>
                                        {(error) => (
                                            <span class="hook-settings-error">{error()}</span>
                                        )}
                                    </Show>
                                    <span class="hook-settings-preview">
                                        预览 <code>{previewFor(row.key)}</code>
                                    </span>
                                </label>
                            )}
                        </For>

                        <label class="hook-settings-field hook-settings-field--compact">
                            <span class="hook-settings-field-title">标题最大长度</span>
                            <span class="hook-settings-field-copy">
                                仅限制 <code>{"{title}"}</code> 的内容，最终文件名仍最多 120 个字符。
                            </span>
                            <input
                                class="hook-terminal-input hook-settings-number-input"
                                type="number"
                                min="1"
                                max="240"
                                value={draft().fileNaming.titleMaxLength}
                                onInput={(event) =>
                                    updateNaming(
                                        "titleMaxLength",
                                        Math.min(
                                            240,
                                            Math.max(1, Number(event.currentTarget.value) || 1),
                                        ),
                                    )
                                }
                            />
                        </label>

                        <div class="hook-settings-placeholder-panel">
                            <div class="hook-settings-field-title">可用占位符</div>
                            <div class="hook-settings-placeholder-grid">
                                <For each={FILE_NAMING_PLACEHOLDERS}>
                                    {(placeholder) => <code>{`{${placeholder}}`}</code>}
                                </For>
                            </div>
                        </div>

                        <div class="hook-settings-policy">
                            冲突策略固定为 <code>name.png → name_2.png → name_3.png</code>，并使用
                            原子创建防止并发覆盖。
                        </div>
                        <Show when={saveError()}>
                            {(error) => <div class="hook-settings-save-error">{error()}</div>}
                        </Show>
                    </div>

                    <footer class="hook-settings-footer">
                        <button
                            type="button"
                            class="hook-terminal-btn"
                            onClick={() => setDraft(cloneSettings(DEFAULT_APP_SETTINGS))}
                        >
                            恢复默认
                        </button>
                        <div class="hook-settings-footer-actions">
                            <button
                                type="button"
                                class="hook-terminal-btn"
                                onClick={() => props.onClose()}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                class="hook-terminal-btn hook-terminal-btn--active"
                                disabled={hasErrors() || saving()}
                                onClick={() => void handleSave()}
                            >
                                {saving() ? "保存中…" : "保存设置"}
                            </button>
                        </div>
                    </footer>
                </section>
            </div>
        </Show>
    );
};
