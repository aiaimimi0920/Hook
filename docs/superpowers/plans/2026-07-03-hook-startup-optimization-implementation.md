# Hook Startup Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Windows startup console flashes and reduce Hook's perceived startup delay without changing user-visible editing behavior.

**Architecture:** Keep Hook's release binary as the only startup surface. Replace startup-time PowerShell font enumeration with native Windows font enumeration in Rust, then move font loading out of the frontend boot critical path. Keep startup visibility ownership in Rust setup so the frontend does not re-show overlay/canvas during session restore.

**Tech Stack:** Tauri 2, Rust, SolidJS, Vitest

---

### Task 1: Lock the startup contract with failing tests

**Files:**
- Create: `Hook/__tests__/integration/StartupExperienceContract.test.ts`
- Test: `Hook/__tests__/integration/StartupExperienceContract.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
expect(libSource).not.toContain('Command::new("powershell.exe")');
expect(appSource).not.toContain("const fonts = await api.getInstalledFonts();");
expect(syncServiceSource).not.toContain("await api.showCanvasWindow();");
expect(syncServiceSource).not.toContain("await api.showOverlayHost(true);");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/integration/StartupExperienceContract.test.ts`
Expected: FAIL because Hook still shells out to PowerShell for fonts and still re-shows startup windows in the frontend boot flow.

### Task 2: Remove startup shell flashing and unblock first paint

**Files:**
- Modify: `Hook/src-tauri/src/lib.rs`
- Modify: `Hook/src/app.tsx`
- Modify: `Hook/src/services/syncService.ts`
- Test: `Hook/__tests__/integration/StartupExperienceContract.test.ts`

- [ ] **Step 1: Replace PowerShell font enumeration with a native Windows implementation**

```rust
#[cfg(target_os = "windows")]
fn collect_installed_font_families_windows() -> Result<Vec<String>, String> { /* ... */ }
```

- [ ] **Step 2: Cache and expose installed fonts without blocking startup shell-free**

```rust
#[tauri::command]
fn get_installed_fonts() -> Result<Vec<String>, String> {
    installed_font_families().map(|fonts| fonts.clone())
}
```

- [ ] **Step 3: Move font loading out of the boot critical path**

```ts
void loadInstalledFontsInBackground();
```

- [ ] **Step 4: Remove frontend startup re-show duplication**

```ts
await syncService.restoreSession(bootProfile || undefined);
```

with no follow-up startup `showCanvasWindow()` / `showOverlayHost()` calls.

- [ ] **Step 5: Run targeted tests and typecheck**

Run: `npm test -- __tests__/integration/StartupExperienceContract.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS
