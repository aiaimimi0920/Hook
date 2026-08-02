# Hook Development Plan

This file records the active implementation contract for changes that span
multiple development sessions. Historical design documents remain useful
references, but this plan is the current operational source of truth.

## Current scope: unified image file naming

Hook must use one naming system for every user-visible image file while keeping
internal content-addressed assets, image-search caches, runtime logs, and other
implementation-only state unchanged.

### Persisted settings

Global settings are stored under Hook's effective application-data directory in
`app-settings.json`:

```json
{
  "schemaVersion": 1,
  "fileNaming": {
    "stickerSavePattern": "Hook_{date}_{time}_{width}x{height}",
    "dragExportPattern": "{label}_{shortId}_{date}_{time}",
    "clipboardFilePattern": "Hook_{kind}_{date}_{time}",
    "titleMaxLength": 80,
    "collisionPolicy": "increment"
  }
}
```

Writes must use a temporary file, flush and sync it, then atomically replace the
destination. Invalid JSON must be preserved as a timestamped corrupt backup and
Hook must continue with defaults.

### Supported placeholders

| Placeholder | Meaning |
| --- | --- |
| `{app}` | Application name (`Hook`) |
| `{kind}` | Export kind such as `sticker` or `art` |
| `{label}` | User-visible capability or content label |
| `{title}` | Optional source title |
| `{process}` | Optional source process or capability identifier |
| `{unitId}` | Full Hook unit identifier |
| `{shortId}` | Last four Unicode scalar values of the unit identifier |
| `{width}` | Exported pixel width |
| `{height}` | Exported pixel height |
| `{date}` | Local date in `yyyyMMdd` format |
| `{time}` | Local time in `HHmmssff` format |
| `{timestamp}` | Unix time in milliseconds |

### Windows filename rules

- Preserve normal Unicode, including Chinese and Japanese text.
- Replace `/ \\ : * ? " < > |` and control characters.
- Reject empty stems, `.` and `..`.
- Neutralize `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, and `LPT1`-`LPT9`.
- Remove trailing spaces and periods.
- Limit final stems to 120 Unicode scalar values.
- Never allow a rendered template to escape its assigned output directory.

### Collision policy

Automatic exports allocate files with `create_new(true)`:

```text
name.png
name_2.png
name_3.png
```

An `exists()` check followed by a normal create is not acceptable because two
concurrent exports could overwrite each other.

### User-visible outputs covered

- automatic sticker image saves;
- Save As dialog default names;
- direct Explorer Shift-drag export;
- native file-drag names exposed to Explorer;
- sticker smart-clipboard file payloads;
- Art clipboard file payloads;
- ordinary and long captures when they are ultimately exported as stickers.

### Explicitly excluded internal names

- session content-addressed image assets;
- image-search cache entries;
- capture transport/cache files that are not exposed as final exports;
- runtime logs and internal state files.

## Future scope (not part of the naming implementation)

- automatic update checks;
- update download and installation;
- signed installer distribution.

Those items must not be implemented as side effects of the current naming work.
