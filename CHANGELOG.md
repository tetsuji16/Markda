# Changelog

All notable changes to Markda are documented in this file.

## 0.1.8 - 2026-07-23

- Opened rendered inline math, block math, fenced math, and Mermaid source editors with a single click.
- Kept Markdown syntax collapsed when the caret is exactly at the right edge of an inline span, matching Typora-style live preview behavior.
- Prevented `Ctrl+S` from blurring or rebuilding active table, code, callout, math, and Mermaid editors, eliminating viewport movement while saving.
- Added Chromium regression coverage for dark-to-light code colors and rendered-source editing interactions.

## 0.1.7 - 2026-07-23

- Improved cursor responsiveness by avoiding unnecessary block-widget refreshes on ordinary paragraph movement.
- Optimized outline tracking and document statistics for large Markdown files.
- Validated toolbar theme changes before synchronizing and persisting them.
- Added regression coverage for theme persistence, message validation, and Unicode statistics.

## 0.1.6 - 2026-07-23

- Standardized all user-facing text and public documentation on English.
- Removed product-comparison copy and related Marketplace metadata.
- Added a GitHub Sponsors link to the README and Marketplace metadata.
- Excluded development-only documents from the published extension package.

## 0.1.5 - 2026-07-23

- Fixed live Markdown initialization so math, tables, code blocks, and inline formatting render correctly on first open.
- Kept light, dark, and automatic theme selections synchronized across open editor tabs and restored webviews.
- Improved table toolbar behavior for focused live cells, including row and column operations that preserve focus.
- Made Mermaid labels render reliably without unsafe SVG foreign objects and bundled the fonts required by KaTeX.
- Preserved the viewport during undo and redo in editable widgets and hid stale Markdown source markers after focus changes.
- Added browser and unit regression coverage for initialization, diagrams, tables, themes, cursor behavior, and widget history.

## 0.1.4 - 2026-07-19

- Added unified undo and redo behavior for source text, editable tables, and code blocks.
- Improved live Markdown marker rendering, list bullets, links, cursor visibility, and active-line highlighting.
- Fixed duplicate plain-text paste handling and kept external document history intact.

## 0.1.3 - 2026-07-19

- Documented and completed the prioritized editing plan.
- Hardened final edit synchronization and IME-aware editable widgets.
- Added regression coverage and verified the optimized production package before publishing.

## 0.1.2 - 2026-07-19

- Made typing responsive in large documents by moving outline, statistics, and preview work off the keystroke path.
- Reduced editor-host traffic by acknowledging local edits without sending the full document back after every change.
- Reduced the initial webview bundle from about 8.9 MB to 1.3 MB by loading Mermaid only when a diagram is rendered.
- Improved initial document rendering and avoided unnecessary full-document work for live decorations and tables.
- Prevented pending edits and IME table-cell text from being stranded when an editor is hidden or closed.
- Added document-style paragraph breaks, smart HTML paste, safer link editing, and direct code-block editing.
- Added numbered-list, block-quote, code-block, strikethrough, and clear-formatting commands.
- Deferred KaTeX as well as Mermaid, delayed optional preview refreshes, and added a lightweight fallback for very large tables.

## 0.1.1 - 2026-07-19

- Replaced the Marketplace icon with Markda's dark live-editor canvas and M/Markdown-arrow identity.

## 0.1.0 - 2026-07-19

Initial preview release.

- Source-preserving live Markdown editing backed by VS Code text documents
- In-place editing for links, tasks, images, tables, code, math, and Mermaid diagrams
- Table controls, image paste and drag-and-drop, outline, file navigation, and document search
- Focus mode, typewriter mode, themes, document statistics, and styled or bare HTML export
- Workspace Trust-aware resource and HTML security settings
