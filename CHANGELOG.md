# Changelog

All notable changes to Markda are documented in this file.

## 0.1.4 - 2026-07-19

- Added unified undo and redo behavior for source text, editable tables, and code blocks.
- Improved live Markdown marker rendering, list bullets, links, cursor visibility, and active-line highlighting.
- Fixed duplicate plain-text paste handling and kept external document updates out of local undo history.

## 0.1.3 - 2026-07-19

- Completed the Typora usability review and documented the prioritized editing plan.
- Hardened final edit synchronization and IME-aware editable widgets.
- Added regression coverage and verified the optimized production package before publishing.

## 0.1.2 - 2026-07-19

- Made typing responsive in large documents by moving outline, statistics, and preview work off the keystroke path.
- Reduced editor-host traffic by acknowledging local edits without sending the full document back after every change.
- Reduced the initial webview bundle from about 8.9 MB to 1.3 MB by loading Mermaid only when a diagram is rendered.
- Improved initial document rendering and avoided unnecessary full-document work for live decorations and tables.
- Prevented pending edits and IME table-cell text from being stranded when an editor is hidden or closed.
- Added Typora-style paragraph breaks, smart HTML paste, safer link editing, and direct code-block editing.
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
