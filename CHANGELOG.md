# Changelog

All notable changes to Markda are documented in this file.

## Unreleased

## 0.1.23 - 2026-08-02

- Refreshed the Markda icon, GitHub social preview, Marketplace hero, and
  introductory copy around source-preserving rendered Markdown editing.

## 0.1.22 - 2026-07-30

- Restored direct access to common list, quote, code, table, and image actions
  on wide editor windows while retaining compact menus at smaller widths.
- Kept both wide and compact toolbar layouts free of horizontal overflow.
- Moved document statistics and heading analysis off the initial paint path.
- Avoided loading the full emoji catalog for ordinary colons in URLs, times,
  and prose, reducing unnecessary startup work.

## 0.1.21 - 2026-07-29

- Kept light and dark code colors independent from generic surface overrides,
  preventing unreadable fenced and inline code after theme changes.
- Drew multi-line selections within each rendered Markdown line instead of
  filling the vertical margins between headings, lists, quotes, and blocks.
- Improved responsive editor controls and accessibility, including keyboard
  toolbar navigation and clearer compact menus.
- Strengthened unit and Chromium regression checks for theme switching,
  selection geometry, editing, saving, and undo behavior.

## 0.1.20 - 2026-07-28

- Disabled contributed Markda keybindings by default to avoid overriding VS
  Code shortcuts. They can be restored with the
  `markda.editor.enableDefaultKeybindings` setting, switched directly from the
  editor toolbar, or assigned individually.
- Added responsive document formatting controls, an H1–H6 style picker, a
  selection toolbar, link editor, slash insertion, and contextual block menu.
- Added visible synchronization state, in-editor statistics/current-section
  status, diagnostic quick fixes, and empty-document onboarding.
- Added file pin/rename/trash/reveal actions plus outline rename, level, and
  section-movement controls.
- Added image resizing and asset auditing, code language/copy controls, and
  block move/duplicate shortcuts.
- Added PNG export, PDF paper and margin settings, theme selection, typography
  controls, and writing presets.
- Removed full-document statistics and heading scans from cursor movement and
  cached status-bar elements and derived document state for faster editing in
  large documents.

## 0.1.19 - 2026-07-27

- Unified source and live-code syntax colors behind the same light/dark CSS palette so every programming-code surface follows theme changes and custom themes consistently.
- Made theme switching paint-only for syntax colors, avoiding CodeMirror state reconfiguration and fenced-code widget reconstruction.
- Added Chromium regression coverage for code backgrounds, keywords, and strings across light-to-dark-to-light transitions while verifying that the live code DOM remains stable.

## 0.1.18 - 2026-07-26

- Preserved all live Markdown editing improvements while consolidating them on the latest `main` release line.
- Removed full-document string allocation from Markdown delimiter pairing and empty-pair deletion.
- Classified live-preview refresh effects in one pass on the latency-sensitive editing path.

## 0.1.17 - 2026-07-26

- Added same-document and cross-document heading anchors plus source-preserving `[toc]` widgets.
- Added lazily loaded YAML Front Matter fields and full emoji-shortcode rendering.
- Added syntax-highlighted editable code blocks, labeled equation numbering, and `\ref` / `\eqref` resolution.
- Mapped VS Code diagnostics into the live editor.
- Added PDF export through Edge, Chrome, or Chromium and Workspace Trust-aware external export targets without shell execution.
- Restyled document search to match VS Code, including a collapsed replace row and compact icon controls.
- Kept Enter and Shift+Enter inside the search field while navigating matches, then restored editing at the selected match on Escape.
- Removed repeated search-panel DOM scans from ordinary editor updates and hardened CodeMirror layout overrides.

## 0.1.16 - 2026-07-26

- Added localized extension metadata and in-editor UI for Arabic, German, Spanish, French, Japanese, Korean, Brazilian Portuguese, Russian, Simplified Chinese, and Traditional Chinese.
- Preserved Mermaid's diagram-level lazy chunks so opening a diagram no longer compiles the entire 3.3 MB renderer bundle.
- Refreshed the Marketplace showcase image to present Markda's primary editing modes and Markdown features more clearly.

## 0.1.15 - 2026-07-26

- Reduced first-file activation cost by splitting the HTML export renderer out of the extension startup bundle.
- Removed unused HTML, CSS, and JavaScript language parsers from the editor startup path and enforced bundle-size budgets.
- Eliminated duplicate initial live-preview work and kept theme updates from rebuilding unchanged syntax highlighting.
- Updated the Files view incrementally instead of rescanning or rebuilding the complete workspace tree when opening and changing Markdown files.
- Added large-document and sub-second Chromium startup regression coverage.

## 0.1.14 - 2026-07-25

- Rendered paragraph soft breaks as spaces in live mode while preserving explicit hard breaks and block boundaries.
- Loaded KaTeX styles on demand and minified production bundles to improve editor startup performance.
- Matched block math and Mermaid source editors to their rendered height and expanded them as content grows.
- Improved pointer-driven block refreshes and added Chromium regression coverage for cursor placement and live-editor layout.

## 0.1.13 - 2026-07-25

- Removed the math and diagrams feature section from the Marketplace introduction.

## 0.1.12 - 2026-07-25

- Refreshed the Marketplace introduction and specification-view screenshot to emphasize source-preserving Markdown editing.

## 0.1.10 - 2026-07-24

- Preserved CRLF and CR-only document separators when synchronizing live-editor changes, preventing edits from drifting after line breaks.
- Loaded workspace Markdown files only when the Files view is first opened, reducing activation work while keeping the view current after file changes.
- Improved keyboard editing, theme, and cursor regression coverage for the live editor.

## 0.1.9 - 2026-07-24

- Added writing and math-editing screenshots to the GitHub and Marketplace introduction.
- Refined the extension description around Markda's calm, source-preserving writing experience.

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
