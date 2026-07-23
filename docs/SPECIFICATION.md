# Markda Specification

## Scope

Markda is a source-preserving Markdown custom editor for VS Code Desktop. It supports local and remote desktop extension hosts on Windows, macOS, and Linux. It is not a web or mobile extension. Supported file extensions are `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn`, and `.txt`.

Markda does not collect telemetry. External URLs and remote resources follow the configured security policy.

## Document model

- The VS Code `TextDocument` is the only persistent source of truth.
- The webview tracks the synchronized document version and sends one text change at a time.
- CodeMirror changes are combined per input frame and sent without a full-document comparison.
- A change uses UTF-16 `from`, `to`, and `insert` values and represents the smallest single replacement after removing a common prefix and suffix.
- The extension host applies a `WorkspaceEdit` only when `baseVersion` matches the current document version. Otherwise, it returns the current text and version.
- Local transactions are acknowledged by ID; external changes trigger a full resynchronization.
- Unedited documents are never rewritten, and content outside an edit range is not reformatted.

## Editor behavior

Live view and source view operate on the same CodeMirror 6 document. Live view hides inactive syntax markers and directly renders headings, quotes, lists, emphasis, links (inline, reference, shortcut, automatic, and bare URL forms), images (block, inline, and reference forms), character entities, escapes, tasks, footnotes, reference definitions, fenced and indented code blocks, permitted HTML, math, Mermaid diagrams, thematic breaks, and tables in the editing surface. Activating a rendered inline object exposes only its Markdown source; editable block objects synchronize their changes back to the original source range.

In ordinary live-view paragraphs, Enter creates a paragraph and Shift+Enter creates a Markdown hard break. Lists, quotes, headings, fenced code blocks, and source view retain structural Markdown behavior. Rich clipboard HTML is converted to Markdown for headings, paragraphs, formatting, links, images, lists, quotes, tables, and code. HTML blocks are directly editable only when both Markdown HTML and unsafe HTML are explicitly enabled; edited HTML is sanitized before it is written back.

Live tables support direct cell editing, IME-safe synchronization, Tab navigation, inline formatting shortcuts, row and column operations, drag reordering, column resizing, and alignment. Tables above the configured cell limit use a lightweight source editor. Code blocks support direct content editing and IME input.

Focus Mode dims lines outside the current line. Typewriter Mode keeps the caret centered after selection changes. These view settings are stored per editor, while document content remains synchronized across split views.

The optional rendered preview supports Markdown, tables, tasks, footnotes, subscript, superscript, highlighting, KaTeX, and Mermaid. Generated HTML is sanitized with DOMPurify. Raw HTML is parsed only when `allowUnsafeHtml` is enabled and is still sanitized afterward.

KaTeX and Mermaid load only when a matching element first appears. The split preview is disabled by default and refreshes only after editing becomes idle.

## VS Code integration

The editor view type is `markda.editor`. Outline shows heading hierarchy, the current section, and filtering. Files lists supported workspace files in a folder hierarchy and provides recent-file, Quick Open, and workspace-search entry points.

Document statistics show words, characters, non-space characters, lines, and estimated reading time. Interactive controls provide accessible names, pressed states where applicable, and visible keyboard focus.

## Security

The webview Content Security Policy uses `default-src 'none'`. Scripts are limited to bundled extension assets with a per-request nonce. Links are sent to the extension host instead of navigating inside the webview. HTTP and HTTPS resources follow the `never`, `prompt`, or `always` policy. HTML export disables raw HTML by default and escapes the document title.

## Export scope

The 0.1 release series supports styled HTML, bare HTML, and exporting again to the previous destination for the document. PDF, image, import, and external conversion-tool support are outside the current scope.

## Acceptance status

| Area | Status | Acceptance criteria |
| --- | --- | --- |
| Text document synchronization | Implemented | Version checks, external updates, split views, minimal replacements |
| Live editing | Implemented | Source preservation, core inline syntax, headings, quotes, and editable widgets |
| Math and diagrams | Implemented | Local KaTeX and Mermaid rendering with sanitized output |
| Outline and files | Implemented | Hierarchy, current location, filtering, recent files, Quick Open, search |
| HTML export | Implemented | Styled and bare output, repeat export, escaped titles |
| Images | Implemented | Safe workspace destinations, collision avoidance, relative URL insertion |
| Table interface | Implemented | Cell editing, row and column operations, reordering, width, alignment, Tab navigation |
| PDF, image, and external formats | Not implemented | Requires signed tools, licensing review, and cross-platform tests |

Version 1.0 requires completion of all planned areas plus Windows, macOS, Linux, accessibility, performance, and security validation.
