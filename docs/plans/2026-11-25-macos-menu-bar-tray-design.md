# macOS Menu Bar Tray

## Context

Fast already has an Electron `Tray`, but its lifecycle is coupled to the desktop pet. With the pet disabled, macOS has no persistent menu bar entry, and disabling the pet while the main window is hidden can quit the app.

## Decision

Use the existing native Electron tray menu. On macOS, create it at application startup regardless of the pet preference. Keep the current singleton tray and its Open Fast / Quit actions. Use a dedicated Fast monochrome template icon with 18×18 and 36×36 resources instead of the system NSActionTemplate glyph.

A normal main-window close on macOS hides the window. Clicking Open Fast or activating the application shows the existing window or recreates it if needed. Cmd+Q and the tray Quit action retain the existing quit path, including owned-engine cleanup.

Windows and Linux retain their current pet-driven tray and close behavior.

## Lifecycle

- Startup: macOS always enables the tray; other platforms enable it only with the pet.
- Pet disabled: macOS keeps the tray and never quits merely because the main window is hidden.
- Close: macOS hides the main window unless application quit is in progress.
- Reopen: existing `showMainWindow` behavior remains unchanged.
- Quit: existing `before-quit` and `will-quit` cleanup remains unchanged.

Hiding the macOS main window preserves the current WorkspaceHub, heartbeat, sessions, and bridge connections instead of running the `closed` / `window-all-closed` cleanup. Task ownership does not change and no separate daemon is introduced. Cmd+Q still runs the full owned-engine and hub cleanup path.

## Testing

Add focused policy tests before implementation:

- macOS enables the tray without the pet.
- Non-macOS tray behavior remains pet-driven.
- macOS close is intercepted with or without the pet.
- Quit is never intercepted.
- Non-macOS close behavior remains unchanged.

Then run the focused tests, related desktop main-process tests, and TypeScript checks.

## Non-goals

- Login-item preferences.
- A React menu bar popover.
- Dock visibility preferences.
- New background-task ownership semantics.
