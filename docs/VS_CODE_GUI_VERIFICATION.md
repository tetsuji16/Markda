# VS Code GUI Verification

Use this checklist in the Extension Development Host after building the extension. It covers the actual VS Code custom editor and the file operations that a DOM-only test cannot exercise.

## Start

1. Open this repository in VS Code and press `F5` to launch the Extension Development Host.
2. Open `docs/DEMO.md`, then run **Markda: Open with Markda** from the Command Palette.
3. Confirm that Markdown is rendered as an editable document, tables and code blocks appear as widgets, the Markda toolbar is visible, and the footer reports **Synced**.

## Editor and selection

1. Click in a paragraph, drag across text, and confirm the selection follows the pointer without jumping to another line.
2. Use **Markda: Toggle Source Code Mode** (`Ctrl+/`) and confirm the Markdown source is visible; toggle back and confirm the rendered document returns.
3. Type a short suffix in a paragraph and confirm the word or character count changes. Press `Ctrl+Z` and confirm the original text and **Synced** status return. Do not save this temporary edit.
4. Click a table cell, edit it, press `Tab`, and confirm focus advances to the next cell while the source remains a Markdown table.

## Recent, pinned, rename, and delete

Use a disposable file under the ignored `.vscode-test` directory so this check does not touch project documents.

1. Create `.vscode-test/gui-smoke.md` in the Explorer, add a short heading, and save it.
2. Open it with Markda. In the Markda **Files** view, confirm it appears under **Recent**. Pin it from the item context menu and confirm it appears under **Pinned**.
3. Rename the file to `.vscode-test/gui-smoke-renamed.md` through the Markda Files item context menu. Confirm both Recent and Pinned point to the renamed file and the document remains open.
4. Delete the disposable file through the same view. Confirm it disappears from Recent and Pinned and from the workspace tree.

## Result record

Record the VS Code version, operating system, and pass/fail result for each section when running this checklist. Automated coverage remains available through `pnpm run check`, `pnpm run test`, `pnpm run test:browser`, and `pnpm run build`.

### Run in this workspace

- VS Code 1.141.0, Windows: opened `docs/DEMO.md` with Markda; confirmed rendered widgets and **Synced** status; switched to source and back; typed a temporary suffix, undid it, and confirmed the original document and **Synced** status. In the Explorer, created `.vscode-test/gui-smoke.md`, edited and saved it in Markda, pinned it, and renamed it to `gui-smoke-renamed.md`; both Recent and Pinned showed the new name and the open document stayed synced. The first UI delete run exposed stale Recent/Pinned entries after the file moved to trash. The delete command now also updates FileProvider after the filesystem delete succeeds. Repeated the GUI delete with the new build and confirmed the file disappeared from disk, Recent, and Pinned.
