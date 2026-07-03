# Legacy Clipboard Implementation (Reference)

## Data Structure
```typescript
interface ClipboardData {
    src: string;
    w: number;
    h: number;
    minified?: boolean;
    savedRect?: { x: number, y: number, w: number, h: number };
    cropOffset?: { x: number, y: number };
    opacityNormal?: number;
    opacityMini?: number;

    // Copy Context
    offsetX: number; // Mouse X - Unit X
    offsetY: number; // Mouse Y - Unit Y
}
```

## Copy Logic (Ctrl+C)
1. Get selected unit.
2. Calculate `offsetX = mousePos.x - unit.x` and `offsetY = mousePos.y - unit.y`.
3. Construct `ClipboardData` object.
4. Set internal signal `setClipboard(data)`.
5. `navigator.clipboard.writeText(JSON.stringify(data))`.

## Paste Logic (Ctrl+V)
1. Check internal `clipboard()` state.
   - If exists, `const clip = clipboard()`.
   - `const mx = mousePos().x`.
   - `const my = mousePos().y`.
   - `const newX = mx - clip.offsetX`.
   - `const newY = my - clip.offsetY`.
   - Create unit at `newX, newY`.
2. If internal is empty, read system clipboard.
   - `navigator.clipboard.readText()`.
   - `JSON.parse(text)`.
   - Check if properties match `ClipboardData` (src, w, h).
   - If match, use same logic as internal (with offsets).
3. If JSON parse fails or structure mismatch, try Image Blob.

## Missing "Offset" in User Request?
The user mentioned "missing offset".
My implementation ALREADY includes `newX = mp.x - clip.offsetX`.
**Hypothesis:** The "offset" might refer to **pasting multiple times**.
In standard apps, if you paste multiple times without moving mouse, it often offsets slightly (e.g. +10px, +10px) to show duplication.
BUT legacy code `mx - clip.offsetX` means it ALWAYS pastes at the exact relative position to the mouse cursor at the time of paste.
If the mouse hasn't moved, it pastes on top.
**WAIT**: In legacy code, did `offsetX` update? No, it's captured at COPY time.
So if I Copy at `Mouse(100,100), Unit(50,50)` -> `Offset(50,50)`.
Then Paste at `Mouse(200,200)` -> `Unit(150,150)`.
This seems correct specifically for *mouse-centered* pasting.

**Alternative**: Maybe user means `cropOffset`?
legacy:
```typescript
if (clip.savedRect && clip.cropOffset) {
    newX = mx - clip.offsetX; // Wait, correct?
    // ...
    // Ah, wait.
    // If it's a cropped unit (minified?), the visual position might be different from logic position?
    // Legacy code:
    // x: newX - clip.cropOffset.x, y: newY - clip.cropOffset.y ??
}
```
I need to check the legacy paste code block I read again (Step 4268 output).

```typescript
// Legacy Paste snippet (implied)
// ...
```
I need to READ lines 840-900 carefully.
One detail: in previous `grep` output (Step 4216), I saw:
`x: newX - clip.cropOffset.x`
`y: newY - clip.cropOffset.y`
This conditional logic seems missing in my simplified version!
I simplified it to just `data: { cropOffset: clip.cropOffset }`.
But in legacy `App.tsx`, it seems to modify `x` and `y` based on `cropOffset` during paste IF the unit has `savedRect`?

I will verify this exact logic block now.
