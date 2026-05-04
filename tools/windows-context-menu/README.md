# GlassBox WhatsApp Windows Context Menu

This adds:

```txt
Right-click file -> Send to WhatsApp -> static chat names
```

Requirement

GlassBox app/API must be running before using the menu.

Install

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\windows-context-menu\install-whatsapp-menu.ps1
```

Remove

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\windows-context-menu\remove-whatsapp-menu.ps1
```

Static chats

- Hasnat (You)
- Bihi
- আমাদের পরিবার
- Tasfia New
- Ammu
- Abbu 2

Note

The menu calls:

```txt
powershell -ExecutionPolicy Bypass -File P:\Hasnat\mirror_browser\tools\windows-context-menu\send-whatsapp-files.ps1 -Chat "<CHAT>" "<FILE1>" "<FILE2>"
```

The wrapper forwards to the existing GlassBox CLI and supports one or more file paths.

## Acceptance Criteria

- [ ] Right-click file menu appears.
- [ ] Submenu shows 6 static chat names.
- [ ] Clicking a chat runs GlassBox CLI with selected file path.
- [ ] GlassBox API is called.
- [ ] Self chat does not require `--allowExternalSend`.
- [ ] Other static chats include `--allowExternalSend`.
- [ ] Remove script removes the menu.
- [ ] No private/debug/runtime artifacts tracked.
