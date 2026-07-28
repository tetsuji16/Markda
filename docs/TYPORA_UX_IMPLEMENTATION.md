# Typora-like UX implementation

This plan tracks the document-first UX work added after 0.1.19. The guiding
constraint remains source preservation: UI operations make focused Markdown
edits and never normalize untouched source.

## Delivered

1. Responsive always-visible controls on wide editors and a selection toolbar.
2. Paragraph/H1–H6 picker and complete common-format controls.
3. Link dialog with clipboard URL detection, title editing, and heading targets.
4. Slash insertion and contextual right-click commands.
5. Existing IME, cursor, selection, widget undo, and large-document suites remain release gates.
6. Visible pending, synchronizing, saved, and external-change states.
7. Diagnostics expose VS Code code actions instead of being display-only.
8. In-editor word/character count, section, mode, and problem status.
9. File pinning, recents, rename, trash, reveal, filtering, Quick Open, and search.
10. Outline rename, promote/demote, section movement, filtering, and current-section tracking.
11. Image clipboard/drop, multi-insert, resizing, alt/path editing, reference updates, and unused-asset audit.
12. Block movement/duplication, list indentation, code language selection, and code copy.
13. HTML, bare HTML, PDF paper/margin controls, PNG export, previous export, and external targets.
14. Light/dark theme selection, custom theme folder, font, size, line height, spacing, and width.
15. Writing presets for Typora-like, distraction-free, technical, and full-width use.
16. Keyboard roles, focus visibility, live regions, reduced motion, high-contrast palette, and accessible widget labels.
17. New webview strings route through the runtime localization catalog.
18. Empty-document onboarding explains slash insertion and source inspection.

## Release verification

- `npm run check`
- `npm test`
- `npm run build`
- `npm run test:browser`

Manual release validation still runs on Windows, macOS, and Linux because host
spellcheckers, IMEs, Chromium printing, trash behavior, and accessibility APIs
are platform services that cannot be proven by one operating system.
