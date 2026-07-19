# Undo and redo

Markda uses one document history for source text and editable live-preview
widgets.

- `Ctrl+Z` (`Cmd+Z` on macOS) undoes the latest local edit and restores the
  selection recorded before that edit.
- `Ctrl+Y` or `Ctrl+Shift+Z` (`Cmd+Shift+Z` on macOS) redoes it.
- Adjacent typing is grouped by CodeMirror's standard typing window. Paste,
  paragraph breaks, formatting commands, and committed widget edits form
  independently undoable operations when they are not part of that typing run.
- A table cell or code-block value still inside its short commit debounce is
  committed before Undo, so pressing the shortcut immediately after typing has
  the same result as pressing it after synchronization.
- Text received from another editor or extension updates the document and maps
  existing history positions, but is not added to this webview's local history.
- Undo/redo shortcuts during an active IME composition are left to the IME.
