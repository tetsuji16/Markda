import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import '@vscode/codicons/dist/codicon.css';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';
import type {
  DocumentStatistics, EditorCommand, EditorSettings, EditorToHostMessage, Heading, HostToEditorMessage, TextChange,
} from '../protocol.js';
import { analyzeDocument, getStatistics } from '../statistics.js';
import {
  addTableColumn, addTableRow, alignTableColumn, deleteTableColumn, deleteTableRow,
  findMarkdownTable, serializeMarkdownTable, tableCursor, type MarkdownTable, type TableAlignment,
} from '../table.js';
import { CompositionCommitGate, historyShortcut, htmlFragmentToMarkdown, liveEnterEdit } from './editorLogic.js';

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: EditorToHostMessage): void;
  getState(): T | undefined;
  setState(state: T): void;
};

interface ViewState {
  schemaVersion: 2;
  sourceMode: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  previewVisible: boolean;
}

type InitializationMessage = Extract<HostToEditorMessage, { type: 'initialize' }>;
const initialDocument = (globalThis as typeof globalThis & { __markdaInitial?: InitializationMessage }).__markdaInitial;

const vscode = acquireVsCodeApi<ViewState>();
const isJapanese = navigator.language.toLocaleLowerCase().startsWith('ja');
const savedViewState = vscode.getState();
// v1 could strand the editor in source mode without a clear visual indication.
// Reset that legacy state once; states saved by this version remain persistent.
const initialViewState: ViewState = savedViewState?.schemaVersion === 2 ? savedViewState : {
  schemaVersion: 2, sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: false,
};
const externalUpdate = Annotation.define<boolean>();
const setMode = StateEffect.define<Partial<ViewState>>();
const refreshLivePreview = StateEffect.define<null>();
const modeField = StateField.define<ViewState>({
  create: () => initialViewState,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setMode)) value = { ...value, ...effect.value };
    return value;
  },
});

let documentUri = initialDocument?.uri ?? '';
let resourceBaseUri = initialDocument?.resourceBaseUri ?? '';
let themeBaseUri = initialDocument?.themeBaseUri ?? '';
let documentVersion = initialDocument?.version ?? 0;
let syncedText = initialDocument?.text ?? '';
let inFlightTransaction: string | undefined;
let inFlightChanges: readonly TextChange[] | undefined;
let pendingChanges: ChangeSet | undefined;
let sendTimer: number | undefined;
let previewTimer: number | undefined;
let derivedStateTimer: number | undefined;
let previewRenderVersion = 0;
let clientRenderer: MarkdownIt | undefined;
let mermaidPromise: Promise<typeof import('mermaid')['default']> | undefined;
let katexPromise: Promise<typeof import('katex')['default']> | undefined;
let katexInstance: typeof import('katex')['default'] | undefined;
let cachedDocumentText = '';
let cachedTable: MarkdownTable | undefined;
let activeTableFrom: number | undefined;
let activeCodeFrom: number | undefined;
let settings: EditorSettings = initialDocument?.settings ?? {
  contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true, previewUpdateDelay: 500, liveTableMaxCells: 600,
  themeMode: 'auto',
  markdown: { math: true, diagrams: true, html: true, breaks: false },
  security: { allowRemoteResources: 'prompt', allowUnsafeHtml: false },
  theme: { light: 'paper', dark: 'midnight' },
};

document.body.innerHTML = `<style>${getStyles()}</style>
<div class="markda-shell">
  <header class="markda-toolbar" aria-label="Editor controls">
    <button data-command="toggleSourceMode" title="Source Code Mode (Ctrl+/)" aria-label="Toggle source code mode" aria-pressed="false"><i class="codicon codicon-code" aria-hidden="true"></i><span>Source</span></button>
    <button data-command="toggleFocusMode" title="Focus Mode (F8)" aria-label="Toggle focus mode" aria-pressed="false"><i class="codicon codicon-target" aria-hidden="true"></i><span>Focus</span></button>
    <button data-command="toggleTypewriterMode" title="Typewriter Mode (F9)" aria-label="Toggle typewriter mode" aria-pressed="false"><i class="codicon codicon-move" aria-hidden="true"></i><span>Typewriter</span></button>
    <span class="toolbar-separator"></span>
    <button data-command="toggleBold" title="Bold (Ctrl+B)" aria-label="Bold"><i class="codicon codicon-bold" aria-hidden="true"></i></button>
    <button data-command="toggleItalic" title="Italic (Ctrl+I)" aria-label="Italic"><i class="codicon codicon-italic" aria-hidden="true"></i></button>
    <button data-command="toggleInlineCode" title="Inline Code" aria-label="Inline code"><i class="codicon codicon-code" aria-hidden="true"></i></button>
    <button data-command="insertLink" title="Link (Ctrl+K)" aria-label="Insert link"><i class="codicon codicon-link" aria-hidden="true"></i></button>
    <button data-command="toggleBulletList" title="Bulleted List" aria-label="Toggle bulleted list"><i class="codicon codicon-list-unordered" aria-hidden="true"></i></button>
    <button data-command="toggleTaskList" title="Task List" aria-label="Toggle task list"><i class="codicon codicon-checklist" aria-hidden="true"></i></button>
    <span class="toolbar-separator"></span>
    <button data-command="insertTable" title="Insert Table" aria-label="Insert table"><i class="codicon codicon-table" aria-hidden="true"></i></button>
    <button data-command="insertImage" title="Insert Images" aria-label="Insert images"><i class="codicon codicon-file-media" aria-hidden="true"></i></button>
    <button data-command="insertMathBlock" title="Insert Math Block" aria-label="Insert math block"><span class="math-icon" aria-hidden="true">∑</span></button>
    <span class="toolbar-spacer"></span>
    <button id="theme-toggle" title="Toggle theme (auto → light → dark)" aria-label="Toggle theme" aria-pressed="false"><i class="codicon codicon-color-mode" aria-hidden="true"></i><span>Theme</span></button>
    <button id="preview-button" title="Rendered Preview" aria-label="Toggle rendered preview" aria-pressed="false"><i class="codicon codicon-preview" aria-hidden="true"></i><span>Preview</span></button>
  </header>
  <div id="table-toolbar" class="table-toolbar" aria-label="Table controls">
    <span>Table</span>
    <button data-table-command="row-before" title="Insert row before"><i class="codicon codicon-arrow-up"></i> Row</button>
    <button data-table-command="row-after" title="Insert row after"><i class="codicon codicon-arrow-down"></i> Row</button>
    <button data-table-command="row-delete" title="Delete row"><i class="codicon codicon-trash"></i> Row</button>
    <span class="toolbar-separator"></span>
    <button data-table-command="column-left" title="Insert column left"><i class="codicon codicon-arrow-left"></i> Col</button>
    <button data-table-command="column-right" title="Insert column right"><i class="codicon codicon-arrow-right"></i> Col</button>
    <button data-table-command="column-delete" title="Delete column"><i class="codicon codicon-trash"></i> Col</button>
    <span class="toolbar-separator"></span>
    <button data-table-command="align-left" title="Align left"><i class="codicon codicon-list-unordered"></i></button>
    <button data-table-command="align-center" title="Align center">↔</button>
    <button data-table-command="align-right" title="Align right"><i class="codicon codicon-list-ordered"></i></button>
  </div>
  <div class="markda-workspace"><div id="editor"></div><aside id="preview" aria-label="Rendered preview"></aside></div>
  <dialog id="table-dialog" aria-labelledby="table-dialog-title"><form method="dialog"><h2 id="table-dialog-title">Insert table</h2><label>Columns <input id="table-columns" type="number" min="1" max="20" value="2"></label><label>Rows <input id="table-rows" type="number" min="1" max="100" value="2"></label><div><button value="cancel">Cancel</button><button id="table-insert-confirm" value="default">Insert</button></div></form></dialog>
</div>`;

const appRoot = document.querySelector<HTMLElement>('.markda-shell')!;
const preview = document.querySelector<HTMLElement>('#preview')!;

const tableDialog = document.querySelector<HTMLDialogElement>('#table-dialog')!;
document.querySelectorAll<HTMLButtonElement>('button[title]').forEach((button) => {
  if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title);
});
document.querySelectorAll<HTMLElement>('.toolbar-separator').forEach((separator) => separator.setAttribute('aria-hidden', 'true'));
if (isJapanese) localizeStaticUi();

const setBlockDecorations = StateEffect.define<DecorationSet>();

/**
 * Block-level live-preview widgets (tables, fenced code blocks, images) live here
 * rather than in the view plugin: CodeMirror throws "Block decorations may not be
 * specified via plugins" if a view plugin's `decorations` property returns block
 * decorations, which corrupts editing (e.g. the cursor jumps to the top).
 */
const blockDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBlockDecorations)) return effect.value;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const view = new EditorView({
  parent: document.querySelector<HTMLElement>('#editor')!,
  state: EditorState.create({
    doc: initialDocument?.text ?? '',
    extensions: [
      modeField,
      history(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      search(),
      keymap.of([
        ...createMarkdaKeymap(),
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      createMarkdownPairing(),
      EditorView.lineWrapping,
      highlightActiveLine(),
      createLivePreviewPlugin(),
      blockDecorationsField,
      EditorView.updateListener.of(onEditorUpdate),
      EditorView.domEventHandlers({
        click(event) {
          const target = event.target as HTMLElement;
          const link = target.closest<HTMLAnchorElement>('a[data-href]');
          if (link?.dataset.href) {
            vscode.postMessage({ type: 'openLink', href: link.dataset.href });
            return true;
          }
          return false;
        },
      }),
    ],
  }),
});

// Test-only accessor: lets integration tests reach the live EditorView instance
// without relying on undocumented DOM symbols. No effect in production.
export function __getEditorView(): EditorView {
  return view;
}

document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
  button.addEventListener('click', () => runCommand(button.dataset.command as EditorCommand));
});
document.querySelectorAll<HTMLButtonElement>('[data-table-command]').forEach((button) => {
  button.addEventListener('click', () => runTableCommand(button.dataset.tableCommand ?? ''));
});
document.querySelector('#preview-button')?.addEventListener('click', () => togglePreview());
const themeToggleButton = document.querySelector<HTMLButtonElement>('#theme-toggle');
function updateThemeToggleLabel(): void {
  if (!themeToggleButton) return;
  const labels: Record<typeof settings.themeMode, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  themeToggleButton.querySelector('span')?.replaceChildren(document.createTextNode(`Theme: ${labels[settings.themeMode]}`));
  themeToggleButton.setAttribute('aria-pressed', String(settings.themeMode !== 'auto'));
  themeToggleButton.title = `Theme: ${labels[settings.themeMode]} (click to change)`;
}
themeToggleButton?.addEventListener('click', () => {
  const order: ('auto' | 'light' | 'dark')[] = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(settings.themeMode) + 1) % order.length] as 'auto' | 'light' | 'dark';
  settings.themeMode = next;
  applySettings();
  updateThemeToggleLabel();
  vscode.postMessage({ type: 'updateThemeMode', mode: next });
});
updateThemeToggleLabel();

document.querySelector('#table-insert-confirm')?.addEventListener('click', () => insertTableFromDialog());
view.dom.addEventListener('paste', (event) => void handlePaste(event));
view.dom.addEventListener('drop', (event) => void receiveImageFiles(event.dataTransfer?.files, event));
preview.addEventListener('scroll', () => syncScroll(preview, view.scrollDOM));
view.scrollDOM.addEventListener('scroll', () => syncScroll(view.scrollDOM, preview));
preview.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).matches('a[data-href]')) {
    event.preventDefault();
    (event.target as HTMLElement).click();
  }
});
window.addEventListener('message', (event: MessageEvent<HostToEditorMessage>) => onHostMessage(event.data));
window.addEventListener('beforeunload', () => {
  synchronizeBeforeSuspend();
  window.clearTimeout(sendTimer);
  window.clearTimeout(previewTimer);
  window.clearTimeout(derivedStateTimer);
});
window.addEventListener('pagehide', synchronizeBeforeSuspend);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') synchronizeBeforeSuspend(); });
applyViewState(initialViewState);
if (initialDocument) {
  applySettings();
  scheduleDerivedStateUpdate();
}
vscode.postMessage({ type: 'ready' });
loadKatex().then(() => {
  view.dispatch({ effects: refreshLivePreview.of(null) });
});

function onHostMessage(message: HostToEditorMessage): void {
  switch (message.type) {
    case 'initialize':
      documentUri = message.uri;
      resourceBaseUri = message.resourceBaseUri;
      themeBaseUri = message.themeBaseUri;
      documentVersion = message.version;
      settings = message.settings;
      syncedText = message.text;
      if (!replaceDocument(message.text)) scheduleDerivedStateUpdate();
      applySettings();
      return;
    case 'documentChanged':
      documentVersion = message.version;
      if (message.sourceTransactionId && message.sourceTransactionId === inFlightTransaction) {
        syncedText = applyTextChanges(syncedText, inFlightChanges ?? []);
        inFlightTransaction = undefined;
        inFlightChanges = undefined;
        flushEdit();
      } else if ('text' in message) {
        syncedText = message.text;
        inFlightTransaction = undefined;
        inFlightChanges = undefined;
        pendingChanges = undefined;
        replaceDocument(message.text);
      }
      return;
    case 'configurationChanged':
      settings = message.settings;
      clientRenderer = undefined;
      applySettings();
      renderPreview();
      return;
    case 'command':
      runCommand(message.command, message.payload);
  }
}

function onEditorUpdate(update: ViewUpdate): void {
  if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalUpdate))) {
    pendingChanges = pendingChanges ? pendingChanges.compose(update.changes) : update.changes;
    scheduleEdit();
  }
  if (update.docChanged) {
    cachedDocumentText = '';
    cachedTable = undefined;
    updateTableToolbar();
    scheduleDerivedStateUpdate();
    if (update.state.field(modeField).previewVisible) schedulePreviewRender();
  }
  else if (update.selectionSet) {
    updateTableToolbar();
    const state = update.state.field(modeField);
    vscode.postMessage({ type: 'state', sourceMode: state.sourceMode, focusMode: state.focusMode, typewriterMode: state.typewriterMode, cursor: update.state.selection.main.head });
  }
  const mode = update.state.field(modeField);
  if (mode.typewriterMode && update.selectionSet && settings.typewriterKeepCentered) {
    view.dispatch({ effects: EditorView.scrollIntoView(update.state.selection.main.head, { y: 'center' }) });
  }
}

function scheduleEdit(): void {
  if (sendTimer !== undefined || inFlightTransaction) return;
  // Coalesce edits from the same input frame while sending the leading edge
  // quickly enough that closing the editor does not strand a debounce tail.
  sendTimer = window.setTimeout(() => { sendTimer = undefined; flushEdit(); }, 0);
}

function flushEdit(): void {
  if (inFlightTransaction || !pendingChanges) return;
  window.clearTimeout(sendTimer);
  sendTimer = undefined;
  const changes = changeSetToTextChanges(pendingChanges);
  pendingChanges = undefined;
  if (!changes.length) return;
  inFlightTransaction = `${documentVersion}:${crypto.randomUUID()}`;
  inFlightChanges = changes;
  vscode.postMessage({
    type: 'edit', uri: documentUri, baseVersion: documentVersion, transactionId: inFlightTransaction,
    changes, selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
  });
}

function changeSetToTextChanges(changes: ChangeSet): TextChange[] {
  const result: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return result;
}

function applyTextChanges(text: string, changes: readonly TextChange[]): string {
  let result = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

function flushActiveEditable(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) active.blur();
}

function synchronizeBeforeSuspend(): void {
  flushActiveEditable();
  flushEdit();
  const expectedText = applyTextChanges(syncedText, inFlightChanges ?? []);
  const text = view.state.doc.toString();
  if (text !== expectedText) {
    // The final snapshot subsumes the unsent tail. Clearing it prevents the tail
    // from being submitted a second time if this hidden webview becomes active.
    pendingChanges = undefined;
    vscode.postMessage({ type: 'finalSync', uri: documentUri, expectedText, text });
  }
}

function replaceDocument(text: string): boolean {
  if (view.state.doc.toString() === text) return false;
  const position = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(position),
    // Host-side edits belong to VS Code's document history. Mapping them
    // through the local history keeps old positions valid without making
    // Ctrl+Z revert somebody else's edit as though it were local typing.
    annotations: [externalUpdate.of(true), Transaction.addToHistory.of(false)],
  });
  return true;
}

function runCommand(command: EditorCommand, payload?: unknown): void {
  const mode = view.state.field(modeField);
  switch (command) {
    case 'toggleSourceMode':
      updateMode({ sourceMode: !mode.sourceMode });
      return;
    case 'toggleFocusMode':
      updateMode({ focusMode: !mode.focusMode });
      return;
    case 'toggleTypewriterMode':
      updateMode({ typewriterMode: !mode.typewriterMode });
      return;
    case 'insertTable':
      tableDialog.showModal();
      return;
    case 'insertMathBlock':
      insertAtSelection('$$\n\\displaystyle x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}\n$$');
      return;
    case 'insertImage':
      if (payload && typeof payload === 'object' && 'images' in payload && Array.isArray(payload.images)) {
        const images = payload.images as { path: string; alt?: string }[];
        insertAtSelection(images.map((image) => `![${image.alt ?? ''}](${image.path})`).join('\n\n'));
      } else if (payload && typeof payload === 'object' && 'path' in payload) {
        const image = payload as { path: string; alt?: string };
        insertAtSelection(`![${image.alt ?? ''}](${image.path})`);
      } else {
        vscode.postMessage({ type: 'requestImage', selection: currentSelection() });
      }
      return;
    case 'showStatistics': {
      const stat = calculateStatistics();
      vscode.postMessage({ type: 'statistics', statistics: stat });
      return;
    }
    case 'showSearch':
      openSearchPanel(view);
      return;
    case 'toggleBold':
      wrapSelection(view, '**', '**');
      return;
    case 'toggleItalic':
      wrapSelection(view, '*', '*');
      return;
    case 'toggleInlineCode':
      wrapSelection(view, '`', '`');
      return;
    case 'insertLink':
      wrapLink(view);
      return;
    case 'setHeading':
      setHeading(view, typeof payload === 'number' ? Math.max(0, Math.min(6, payload)) : 1);
      return;
    case 'toggleBulletList':
      toggleLinePrefix('- ');
      return;
    case 'toggleOrderedList':
      toggleOrderedList();
      return;
    case 'toggleTaskList':
      toggleLinePrefix('- [ ] ');
      return;
    case 'toggleBlockquote':
      toggleBlockquote();
      return;
    case 'toggleStrikethrough':
      wrapSelection(view, '~~', '~~');
      return;
    case 'insertCodeBlock':
      wrapCodeBlock(view);
      return;
    case 'clearFormatting':
      clearFormatting(view);
      return;
    case 'replaceImageSource':
      updateImageSource(payload, false);
      return;
    case 'removeImageSource':
      updateImageSource(payload, true);
      return;
    case 'copyAsMarkdown': {
      const selection = view.state.selection.main;
      const text = selection.empty ? view.state.doc.toString() : view.state.sliceDoc(selection.from, selection.to);
      vscode.postMessage({ type: 'copyToClipboard', text });
      return;
    }
    case 'insertText':
      if (payload && typeof payload === 'object' && 'text' in payload && typeof payload.text === 'string') insertAtSelection(payload.text);
      return;
    case 'focusHeading': {
      const heading = payload as Heading;
      if (heading && Number.isInteger(heading.from)) {
        const position = Math.max(0, Math.min(heading.from, view.state.doc.length));
        view.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position, { y: 'center' }) });
        view.focus();
      }
    }
  }
}

function updateMode(change: Partial<ViewState>): void {
  const next = { ...view.state.field(modeField), ...change };
  view.dispatch({ effects: setMode.of(change) });
  applyViewState(next);
  vscode.setState(next);
  vscode.postMessage({ type: 'state', sourceMode: next.sourceMode, focusMode: next.focusMode, typewriterMode: next.typewriterMode });
}

function togglePreview(): void {
  const mode = view.state.field(modeField);
  updateMode({ previewVisible: !mode.previewVisible });
  if (!mode.previewVisible) renderPreview();
}

function applyViewState(state: ViewState): void {
  appRoot.classList.toggle('source-mode', state.sourceMode);
  appRoot.classList.toggle('focus-mode', state.focusMode);
  appRoot.classList.toggle('typewriter-mode', state.typewriterMode);
  appRoot.classList.toggle('preview-visible', state.previewVisible);
  for (const key of ['toggleSourceMode', 'toggleFocusMode', 'toggleTypewriterMode'] as const) {
    const active = key === 'toggleSourceMode' ? state.sourceMode : key === 'toggleFocusMode' ? state.focusMode : state.typewriterMode;
    const button = document.querySelector<HTMLButtonElement>(`[data-command="${key}"]`);
    button?.classList.toggle('active', active);
    button?.setAttribute('aria-pressed', String(active));
  }
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-button');
  previewButton?.classList.toggle('active', state.previewVisible);
  previewButton?.setAttribute('aria-pressed', String(state.previewVisible));
}

function applySettings(): void {
  // A contentWidth of 0 (or unset) means "fill the window" — the editor area
  // grows with the window instead of being capped at a fixed measure.
  const contentWidth = settings.contentWidth && settings.contentWidth > 0 ? `${settings.contentWidth}px` : 'none';
  document.documentElement.style.setProperty('--markda-content-width', contentWidth);
  // When capped, center the content; when filling the window, use a fixed gutter.
  const paddingX = '24px';
  document.documentElement.style.setProperty('--markda-padding-x', paddingX);
  const dark = settings.themeMode === 'dark'
    || (settings.themeMode === 'auto'
      && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')));
  const themeName = (dark ? settings.theme.dark : settings.theme.light).replace(/[^a-zA-Z0-9._-]/gu, '');
  document.body.dataset.markdaTheme = themeName;
  // Reliable caret color fallback per theme (VS Code's editorCursor.foreground
  // is often not injected into the webview, so we guarantee a visible color).
  document.documentElement.style.setProperty('--markda-cursor-color', dark ? '#ffffff' : '#1a1a1a');
  // Self-contained light/dark backgrounds so the editor area follows the chosen
  // theme even when VS Code does not inject editor.background/foreground.
  document.documentElement.style.setProperty('--markda-bg', dark ? '#1e1e1e' : '#ffffff');
  document.documentElement.style.setProperty('--markda-fg', dark ? '#d4d4d4' : '#1a1a1a');
  let themeLink = document.querySelector<HTMLLinkElement>('#markda-user-theme');
  if (!themeLink) {
    themeLink = document.createElement('link');
    themeLink.id = 'markda-user-theme';
    themeLink.rel = 'stylesheet';
    document.head.append(themeLink);
  }
  themeLink.href = themeBaseUri && themeName ? `${themeBaseUri}${encodeURIComponent(themeName)}.css` : '';
}

function insertAtSelection(value: string): void {
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: value },
    selection: EditorSelection.cursor(selection.from + value.length),
    scrollIntoView: true,
  });
  view.focus();
}

function updateImageSource(payload: unknown, remove: boolean): void {
  if (!payload || typeof payload !== 'object' || !('source' in payload) || typeof payload.source !== 'string'
    || !('from' in payload) || typeof payload.from !== 'number') return;
  const line = view.state.doc.lineAt(Math.min(payload.from, view.state.doc.length));
  if (remove) {
    const to = line.number < view.state.doc.lines ? line.to + 1 : line.to;
    view.dispatch({ changes: { from: line.from, to, insert: '' } });
    return;
  }
  if (!('newSource' in payload) || typeof payload.newSource !== 'string') return;
  const relative = line.text.indexOf(payload.source);
  if (relative < 0) return;
  const from = line.from + relative;
  view.dispatch({ changes: { from, to: from + payload.source.length, insert: payload.newSource } });
}

function toggleLinePrefix(prefix: string): void {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const last = view.state.doc.lineAt(selection.to);
  const lines = Array.from({ length: last.number - first.number + 1 }, (_value, index) => view.state.doc.line(first.number + index));
  const expression = prefix.includes('[ ]') ? /^\s*[-+*]\s+\[[ xX]\]\s+/u : /^\s*[-+*]\s+/u;
  const remove = lines.every((line) => expression.test(line.text));
  view.dispatch({
    changes: lines.map((line) => remove
      ? { from: line.from, to: line.from + (line.text.match(expression)?.[0].length ?? 0), insert: '' }
      : { from: line.from, insert: prefix }),
  });
  view.focus();
}

function toggleOrderedList(): void {
  toggleLinePrefixes(/^\s*\d+[.)]\s+/u, (index) => `${index + 1}. `);
}

function toggleBlockquote(): void {
  toggleLinePrefixes(/^\s*>\s?/u, () => '> ');
}

function toggleLinePrefixes(expression: RegExp, prefix: (index: number) => string): void {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const last = view.state.doc.lineAt(selection.to);
  const lines = Array.from({ length: last.number - first.number + 1 }, (_value, index) => view.state.doc.line(first.number + index));
  const remove = lines.every((line) => expression.test(line.text));
  view.dispatch({ changes: lines.map((line, index) => ({
    from: line.from,
    to: remove ? line.from + (line.text.match(expression)?.[0].length ?? 0) : line.from,
    insert: remove ? '' : prefix(index),
  })) });
  view.focus();
}

function wrapCodeBlock(editor: EditorView): boolean {
  const selection = editor.state.selection.main;
  const selected = editor.state.sliceDoc(selection.from, selection.to);
  const fenced = selected.match(/^```[^\n]*\n([\s\S]*?)\n```$/u);
  const insert = fenced ? fenced[1] ?? '' : `\`\`\`\n${selected}\n\`\`\``;
  editor.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: EditorSelection.cursor(selection.from + insert.length) });
  return true;
}

function clearFormatting(editor: EditorView): boolean {
  const selection = editor.state.selection.main;
  const line = editor.state.doc.lineAt(selection.head);
  const from = selection.empty ? line.from : selection.from;
  const to = selection.empty ? line.to : selection.to;
  const original = editor.state.sliceDoc(from, to);
  const cleared = original
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?\S)\1/gu, '$2')
    .replace(/(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1');
  if (cleared === original) return true;
  editor.dispatch({ changes: { from, to, insert: cleared }, selection: EditorSelection.range(from, from + cleared.length) });
  return true;
}

function insertTableFromDialog(): void {
  const columns = clampNumber(Number(document.querySelector<HTMLInputElement>('#table-columns')?.value), 1, 20);
  const rows = clampNumber(Number(document.querySelector<HTMLInputElement>('#table-rows')?.value), 1, 100);
  const header = `| ${Array.from({ length: columns }, (_value, index) => `Column ${index + 1}`).join(' | ')} |`;
  const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
  const row = `| ${Array.from({ length: columns }, () => '').join(' | ')} |`;
  insertAtSelection([header, separator, ...Array.from({ length: rows }, () => row)].join('\n'));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Math.round(value) : minimum));
}

async function receiveImageFiles(files: FileList | undefined, event: Event): Promise<void> {
  const images = Array.from(files ?? []).filter((file) => /^image\/(?:png|jpeg|gif|webp)$/iu.test(file.type));
  if (!images.length) return;
  event.preventDefault();
  const values = await Promise.all(images.map(async (file, index) => ({
    name: file.name || `pasted-image-${index + 1}`,
    dataUrl: await readDataUrl(file),
  })));
  vscode.postMessage({ type: 'saveImages', selection: currentSelection(), images: values });
}

async function handlePaste(event: ClipboardEvent): Promise<void> {
  const editable = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[contenteditable="true"]') : null;
  // CodeMirror's own editing surface is contenteditable too. Treating it like a
  // live table/code widget mutates its DOM behind the editor and duplicates text.
  if (editable && !editable.classList.contains('cm-content')) {
    if (event.clipboardData?.files.length) {
      event.preventDefault();
      return;
    }
    const html = event.clipboardData?.getData('text/html') ?? '';
    const plain = event.clipboardData?.getData('text/plain') ?? '';
    const value = editable.matches('code') ? plain : html ? htmlFragmentToMarkdown(html) : plain;
    if (value) {
      event.preventDefault();
      insertTextIntoEditable(editable, value);
    }
    return;
  }
  if (event.clipboardData?.files.length) {
    await receiveImageFiles(event.clipboardData.files, event);
    return;
  }
  if (view.state.field(modeField).sourceMode) return;
  const html = event.clipboardData?.getData('text/html') ?? '';
  if (!html) return;
  const markdown = htmlFragmentToMarkdown(html);
  if (!markdown) return;
  event.preventDefault();
  insertAtSelection(markdown);
}

function insertTextIntoEditable(editable: HTMLElement, value: string): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const textNode = document.createTextNode(value);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}



function localizeStaticUi(): void {
  document.documentElement.lang = 'ja';
  const labels: Partial<Record<EditorCommand, string>> = {
    toggleSourceMode: 'ソース表示 (Ctrl+/)', toggleFocusMode: 'フォーカスモード (F8)', toggleTypewriterMode: 'タイプライターモード (F9)',
    toggleBold: '太字 (Ctrl+B)', toggleItalic: '斜体 (Ctrl+I)', toggleInlineCode: 'インラインコード', insertLink: 'リンク (Ctrl+K)',
    toggleBulletList: '箇条書き', toggleTaskList: 'タスクリスト', insertTable: '表を挿入', insertImage: '画像を挿入', insertMathBlock: '数式ブロックを挿入',
  };
  document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
    const label = labels[button.dataset.command as EditorCommand];
    if (label) { button.title = label; button.ariaLabel = label; }
  });
  const visible: Record<string, string> = { Source: 'ソース', Focus: 'フォーカス', Typewriter: 'タイプライター', Preview: 'プレビュー', Table: '表' };
  document.querySelectorAll<HTMLElement>('button span,.table-toolbar>span:first-child').forEach((element) => { if (visible[element.textContent ?? '']) element.textContent = visible[element.textContent ?? ''] ?? ''; });
  const previewButton = document.querySelector<HTMLButtonElement>('#preview-button');
  if (previewButton) { previewButton.title = 'レンダリングプレビュー'; previewButton.ariaLabel = 'レンダリングプレビューを切り替え'; }
  document.querySelector('#table-dialog-title')!.textContent = '表を挿入';
  document.querySelectorAll<HTMLLabelElement>('#table-dialog label').forEach((label, index) => { label.firstChild!.textContent = index === 0 ? '列数 ' : '行数 '; });
}

let syncingScroll = false;
function syncScroll(source: HTMLElement, target: HTMLElement): void {
  if (syncingScroll || !view.state.field(modeField).previewVisible) return;
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  if (sourceRange <= 0 || targetRange <= 0) return;
  syncingScroll = true;
  target.scrollTop = source.scrollTop / sourceRange * targetRange;
  requestAnimationFrame(() => { syncingScroll = false; });
}

function updateDocumentDerivedState(): void {
  const source = view.state.doc.toString();
  cachedDocumentText = source;
  cachedTable = undefined;
  const { headings, statistics: stat } = analyzeDocument(source);
  vscode.postMessage({ type: 'outline', headings });
  vscode.postMessage({ type: 'statistics', statistics: stat });
  const mode = view.state.field(modeField);
  vscode.postMessage({ type: 'state', sourceMode: mode.sourceMode, focusMode: mode.focusMode, typewriterMode: mode.typewriterMode, cursor: view.state.selection.main.head });
  updateTableToolbar(source);
}

function scheduleDerivedStateUpdate(): void {
  window.clearTimeout(derivedStateTimer);
  // Outline and document statistics are useful shortly after typing settles, but
  // neither belongs on the latency-sensitive keystroke path.
  derivedStateTimer = window.setTimeout(updateDocumentDerivedState, 180);
}

function calculateStatistics(): DocumentStatistics {
  const selection = view.state.selection.main;
  return getStatistics(view.state.doc.toString(), view.state.sliceDoc(selection.from, selection.to));
}

function extractHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  const expression = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gmu;
  for (const match of text.matchAll(expression)) {
    const from = match.index ?? 0;
    headings.push({ level: match[1]?.length ?? 1, text: match[2] ?? '', from, to: from + match[0].length });
  }
  return headings;
}

function currentSelection(): { anchor: number; head: number } {
  return { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
}

function createMarkdownPairing() { return EditorView.inputHandler.of((editor, from, to, text) => {
  if (!settings.autoPairMarkdown || text.length !== 1) return false;
  const pairs: Record<string, string> = { '*': '*', '_': '_', '`': '`', '[': ']', '(': ')', '{': '}', '"': '"', "'": "'" };
  if (settings.markdown.math) pairs.$ = '$';
  const closing = pairs[text];
  if (!closing) return false;
  const selected = editor.state.sliceDoc(from, to);
  if (selected.length === 0 && editor.state.sliceDoc(to, to + 1) === text && closing === text) {
    editor.dispatch({ selection: EditorSelection.cursor(to + 1) });
    return true;
  }
  const inserted = `${text}${selected}${closing}`;
  editor.dispatch({ changes: { from, to, insert: inserted }, selection: EditorSelection.cursor(from + text.length + selected.length) });
  return true;
}); }

// Move the cursor exactly one line up/down, preserving the column. CodeMirror's
// built-in vertical motion relies on layout coordinates which the live-preview
// decorations can perturb (cursor jumps to the document top); this explicit
// handler keeps motion deterministic regardless of decoration state. When Shift
// is held the selection anchor is preserved so the range extends/contracts by one line.
function moveCursorVertically(editor: EditorView, dir: 1 | -1, extend: boolean): boolean {
  const selection = editor.state.selection.main;
  const doc = editor.state.doc;
  const line = doc.lineAt(selection.head);
  const targetLineNumber = line.number + dir;
  if (targetLineNumber < 1 || targetLineNumber > doc.lines) return false;
  const targetLine = doc.line(targetLineNumber);
  const column = Math.min(selection.head - line.from, targetLine.length);
  const head = targetLine.from + column;
  const next = extend
    ? EditorSelection.range(selection.anchor, head)
    : EditorSelection.cursor(head);
  editor.dispatch({ selection: next });
  return true;
}

function createMarkdaKeymap() {
  return [
    { key: 'Enter', run: (editor: EditorView) => insertLiveLineBreak(editor, false) },
    { key: 'Shift-Enter', run: (editor: EditorView) => insertLiveLineBreak(editor, true) },
    { key: 'ArrowUp', run: (editor: EditorView) => moveCursorVertically(editor, -1, false) },
    { key: 'ArrowDown', run: (editor: EditorView) => moveCursorVertically(editor, 1, false) },
    { key: 'Shift-ArrowUp', run: (editor: EditorView) => moveCursorVertically(editor, -1, true) },
    { key: 'Shift-ArrowDown', run: (editor: EditorView) => moveCursorVertically(editor, 1, true) },
    { key: 'Tab', run: (editor: EditorView) => navigateTableCell(editor, false) },
    { key: 'Shift-Tab', run: (editor: EditorView) => navigateTableCell(editor, true) },
    { key: 'Mod-b', run: (editor: EditorView) => wrapSelection(editor, '**', '**') },
    { key: 'Mod-i', run: (editor: EditorView) => wrapSelection(editor, '*', '*') },
    { key: 'Mod-k', run: (editor: EditorView) => wrapLink(editor) },
    { key: 'Mod-Shift-`', run: (editor: EditorView) => wrapSelection(editor, '`', '`') },
    { key: 'Mod-Shift-[', run: () => { toggleOrderedList(); return true; } },
    { key: 'Mod-Shift-]', run: () => { toggleLinePrefix('- '); return true; } },
    { key: 'Mod-Shift-q', run: () => { toggleBlockquote(); return true; } },
    { key: 'Mod-Shift-k', run: (editor: EditorView) => wrapCodeBlock(editor) },
    { key: 'Alt-Shift-5', run: (editor: EditorView) => wrapSelection(editor, '~~', '~~') },
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `Mod-${index + 1}`,
      run: (editor: EditorView) => setHeading(editor, index + 1),
    })),
    { key: 'Mod-0', run: (editor: EditorView) => setHeading(editor, 0) },
  ];
}

function insertLiveLineBreak(editor: EditorView, shiftKey: boolean): boolean {
  if (editor.state.field(modeField).sourceMode) return false;
  const selection = editor.state.selection.main;
  if (!selection.empty) return false;
  let syntax = syntaxTree(editor.state).resolveInner(selection.head, -1);
  let insideFence = false;
  for (;;) {
    if (syntax.name === 'FencedCode') { insideFence = true; break; }
    if (!syntax.parent) break;
    syntax = syntax.parent;
  }
  const line = editor.state.doc.lineAt(selection.head);
  const contextLine = Math.min(editor.state.doc.lines, line.number + 2);
  const contextTo = editor.state.doc.line(contextLine).to;
  const context = editor.state.sliceDoc(line.from, contextTo);
  const edit = liveEnterEdit(context, selection.head - line.from, shiftKey, insideFence);
  if (!edit) return false;
  editor.dispatch({
    changes: { from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert },
    selection: EditorSelection.cursor(line.from + edit.cursor),
  });
  return true;
}

function updateTableToolbar(source = cachedDocumentText): void {
  const position = view.state.selection.main.head;
  // Almost every cursor move is outside a table. Avoid materializing and splitting
  // the complete document unless the active line can actually be a table row.
  if (!view.state.doc.lineAt(position).text.includes('|')) {
    appRoot.classList.remove('table-active');
    return;
  }
  if (!source) source = view.state.doc.toString();
  const table = cachedTable && position >= cachedTable.from && position <= cachedTable.to
    ? cachedTable
    : findMarkdownTable(source, position, view.state.doc.lineAt(position).number - 1);
  cachedTable = table;
  appRoot.classList.toggle('table-active', Boolean(table));
  const cursor = table ? tableCursor(source, table, position) : undefined;
  document.querySelector<HTMLButtonElement>('[data-table-command="row-delete"]')!.disabled = !table || (cursor?.row ?? -1) < 0;
  document.querySelector<HTMLButtonElement>('[data-table-command="column-delete"]')!.disabled = !table || table.header.length <= 1;
}

function runTableCommand(command: string): void {
  const source = view.state.doc.toString();
  const table = findMarkdownTable(source, view.state.selection.main.head, view.state.doc.lineAt(view.state.selection.main.head).number - 1);
  if (!table) return;
  const cursor = tableCursor(source, table, view.state.selection.main.head);
  let updated: MarkdownTable = table;
  switch (command) {
    case 'row-before':
      updated = addTableRow(table, Math.max(0, cursor.row));
      break;
    case 'row-after':
      updated = addTableRow(table, cursor.row < 0 ? 0 : cursor.row + 1);
      break;
    case 'row-delete':
      updated = deleteTableRow(table, cursor.row);
      break;
    case 'column-left':
      updated = addTableColumn(table, cursor.column);
      break;
    case 'column-right':
      updated = addTableColumn(table, cursor.column + 1);
      break;
    case 'column-delete':
      updated = deleteTableColumn(table, cursor.column);
      break;
    case 'align-left':
      updated = alignTableColumn(table, cursor.column, 'left');
      break;
    case 'align-center':
      updated = alignTableColumn(table, cursor.column, 'center');
      break;
    case 'align-right':
      updated = alignTableColumn(table, cursor.column, 'right');
      break;
    default:
      return;
  }
  replaceTable(source, table, updated, cursor.row, Math.min(cursor.column, updated.header.length - 1));
}

function replaceTable(source: string, original: MarkdownTable, updated: MarkdownTable, row: number, column: number): void {
  const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  const replacement = serializeMarkdownTable(updated, eol);
  view.dispatch({ changes: { from: original.from, to: original.to, insert: replacement } });
  const reparsed = findMarkdownTable(view.state.doc.toString(), original.from, view.state.doc.lineAt(original.from).number - 1);
  if (reparsed) {
    const position = tableCellPosition(view.state, reparsed, row, column);
    view.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position) });
  }
  view.focus();
}

function navigateTableCell(editor: EditorView, backwards: boolean): boolean {
  const source = editor.state.doc.toString();
  const table = findMarkdownTable(source, editor.state.selection.main.head, editor.state.doc.lineAt(editor.state.selection.main.head).number - 1);
  if (!table) return false;
  const cursor = tableCursor(source, table, editor.state.selection.main.head);
  const rowCount = table.rows.length + 1;
  const columnCount = table.header.length;
  const linear = (cursor.row + 1) * columnCount + cursor.column + (backwards ? -1 : 1);
  if (linear < 0) return false;
  if (linear >= rowCount * columnCount) {
    if (!backwards) {
      const updated = addTableRow(table, table.rows.length);
      replaceTable(source, table, updated, updated.rows.length - 1, 0);
      return true;
    }
    return false;
  }
  const nextRow = Math.floor(linear / columnCount) - 1;
  const nextColumn = linear % columnCount;
  const position = tableCellPosition(editor.state, table, nextRow, nextColumn);
  editor.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position) });
  return true;
}

function tableCellPosition(state: EditorState, table: MarkdownTable, row: number, column: number): number {
  const lineNumber = table.startLine + 1 + (row < 0 ? 0 : row + 2);
  const line = state.doc.line(Math.min(state.doc.lines, lineNumber));
  let pipeCount = 0;
  let escaped = false;
  for (let index = 0; index < line.text.length; index++) {
    const character = line.text[index];
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '|') {
      if (pipeCount === column) return Math.min(line.to, line.from + index + 2);
      pipeCount++;
    }
  }
  return line.to;
}

function wrapSelection(editor: EditorView, open: string, close: string): boolean {
  const selection = editor.state.selection.main;
  const selected = editor.state.sliceDoc(selection.from, selection.to);
  if (selection.from >= open.length
    && editor.state.sliceDoc(selection.from - open.length, selection.from) === open
    && editor.state.sliceDoc(selection.to, selection.to + close.length) === close) {
    editor.dispatch({
      changes: [
        { from: selection.from - open.length, to: selection.from, insert: '' },
        { from: selection.to, to: selection.to + close.length, insert: '' },
      ],
      selection: selected
        ? EditorSelection.range(selection.from - open.length, selection.to - open.length)
        : EditorSelection.cursor(selection.from - open.length),
    });
    return true;
  }
  const inserted = `${open}${selected}${close}`;
  editor.dispatch({
    changes: { from: selection.from, to: selection.to, insert: inserted },
    selection: selected
      ? EditorSelection.range(selection.from + open.length, selection.from + open.length + selected.length)
      : EditorSelection.cursor(selection.from + open.length),
  });
  return true;
}

function wrapLink(editor: EditorView): boolean {
  const selection = editor.state.selection.main;
  const selected = editor.state.sliceDoc(selection.from, selection.to);
  const inserted = `[${selected}]()`;
  editor.dispatch({
    changes: { from: selection.from, to: selection.to, insert: inserted },
    selection: EditorSelection.cursor(selection.from + inserted.length - 1),
  });
  return true;
}

function setHeading(editor: EditorView, level: number): boolean {
  const line = editor.state.doc.lineAt(editor.state.selection.main.head);
  const existing = line.text.match(/^#{1,6}[ \t]+/u)?.[0] ?? '';
  const replacement = level === 0 ? '' : `${'#'.repeat(level)} `;
  editor.dispatch({ changes: { from: line.from, to: line.from + existing.length, insert: replacement } });
  return true;
}

function renderPreview(): void {
  if (!view.state.field(modeField).previewVisible) return;
  window.clearTimeout(previewTimer);
  const renderVersion = ++previewRenderVersion;
  const renderer = clientRenderer ??= createClientRenderer();
  const rendered = renderer.render(prepareMarkdownForPreview(view.state.doc.toString()));
  preview.innerHTML = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ['target', 'data-href', 'aria-label'],
  });
  preview.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    link.dataset.href = link.getAttribute('href') ?? '';
    link.removeAttribute('href');
    link.tabIndex = 0;
  });
  preview.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => secureImage(image));
  wirePreviewTasks();
  wirePreviewNavigation();
  void renderMathPlaceholders(renderVersion);
  void renderMermaidBlocks(renderVersion);
}

function wirePreviewNavigation(): void {
  const headings = extractHeadings(view.state.doc.toString());
  preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((element, index) => {
    const heading = headings[index];
    if (!heading) return;
    element.tabIndex = 0;
    element.title = 'Click to edit this section';
    const focus = () => { view.dispatch({ selection: EditorSelection.cursor(heading.from), effects: EditorView.scrollIntoView(heading.from, { y: 'center' }) }); view.focus(); };
    element.addEventListener('click', focus);
    element.addEventListener('keydown', (event) => { if (event.key === 'Enter') focus(); });
  });
}

function wirePreviewTasks(): void {
  const offsets = taskMarkerOffsets(view.state.doc.toString());
  preview.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox').forEach((checkbox, index) => {
    const from = offsets[index];
    if (from === undefined) return;
    checkbox.disabled = false;
    checkbox.addEventListener('change', () => {
      view.dispatch({ changes: { from, to: from + 1, insert: checkbox.checked ? 'x' : ' ' } });
    });
  });
}

function taskMarkerOffsets(source: string): number[] {
  const offsets: number[] = [];
  let position = 0;
  let fenced = false;
  for (const line of source.split('\n')) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    else if (!fenced) {
      const match = line.match(/^(\s*[-+*]\s+\[)([ xX])\]/u);
      if (match) offsets.push(position + (match[1]?.length ?? 0));
    }
    position += line.length + 1;
  }
  return offsets;
}

function schedulePreviewRender(): void {
  window.clearTimeout(previewTimer);
  // The live editor is already the primary preview. Keep the optional split
  // preview entirely off the typing path and refresh only after a real pause.
  previewTimer = window.setTimeout(renderPreview, settings.previewUpdateDelay);
}

function secureImage(image: HTMLImageElement): void {
  const source = image.getAttribute('src') ?? '';
  if (/^https?:/iu.test(source)) {
    if (settings.security.allowRemoteResources === 'always') return;
    const blocked = document.createElement('span');
    blocked.className = 'markda-remote-blocked';
    blocked.textContent = `Remote image blocked: ${image.alt || source}`;
    blocked.title = source;
    image.replaceWith(blocked);
    return;
  }
  if (/^(?:data:|vscode-webview:|#)/iu.test(source)) return;
  try {
    image.src = new URL(source, resourceBaseUri).toString();
  } catch {
    image.replaceWith(document.createTextNode(image.alt || source));
  }
}

function createClientRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({ breaks: settings.markdown.breaks, html: settings.markdown.html && settings.security.allowUnsafeHtml, linkify: true });
  renderer.use(footnote).use(mark).use(sub).use(sup).use(taskLists, { enabled: true, label: true });
  if (settings.markdown.math) installMath(renderer);
  return renderer;
}

function installMath(renderer: MarkdownIt): void {
  renderer.inline.ruler.after('escape', 'markda_math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    const end = state.src.indexOf('$', state.pos + 1);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('markda_math_inline', 'math', 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  renderer.renderer.rules.markda_math_inline = (tokens, index) =>
    `<span class="markda-math-placeholder" data-markda-math="inline">${renderer.utils.escapeHtml(tokens[index]?.content ?? '')}</span>`;
  const defaultFence = renderer.renderer.rules.fence;
  renderer.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token?.info.trim() === 'math') return `<div class="markda-math-placeholder" data-markda-math="block">${renderer.utils.escapeHtml(token.content)}</div>`;
    return defaultFence
      ? defaultFence(tokens, index, options, env, self)
      : `<pre><code>${renderer.utils.escapeHtml(token?.content ?? '')}</code></pre>\n`;
  };
}

function prepareMarkdownForPreview(source: string): string {
  if (!settings.markdown.math) return source;
  return source.replace(/^\$\$[ \t]*\r?\n([\s\S]*?)\r?\n\$\$[ \t]*$/gmu, (_match, expression: string) => `\`\`\`math\n${expression}\n\`\`\``);
}

function loadKatex(): Promise<typeof import('katex')['default']> {
  return katexPromise ??= import('./katexLoader.js').then((module) => {
    katexInstance = module.api;
    return module.api;
  });
}

async function renderKatexInto(element: HTMLElement, source: string, displayMode: boolean): Promise<void> {
  try {
    const katex = await loadKatex();
    if (!element.isConnected) return;
    katex.render(source, element, { displayMode, throwOnError: false, strict: 'warn', trust: false });
  } catch (error) {
    if (element.isConnected) {
      element.classList.add('markda-render-error');
      element.textContent = String(error);
    }
  }
}

async function renderMathPlaceholders(renderVersion: number): Promise<void> {
  const placeholders = Array.from(preview.querySelectorAll<HTMLElement>('[data-markda-math]'));
  if (!placeholders.length) return;
  await loadKatex();
  if (renderVersion !== previewRenderVersion) return;
  await Promise.all(placeholders.map((element) => renderKatexInto(
    element, element.textContent ?? '', element.dataset.markdaMath === 'block',
  )));
}

async function renderMermaidBlocks(renderVersion: number): Promise<void> {
  if (!settings.markdown.diagrams) return;
  const blocks = Array.from(preview.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
  if (!blocks.length) return;
  const mermaid = await loadMermaid();
  if (renderVersion !== previewRenderVersion) return;
  initializeMermaid(mermaid);
  for (const [index, block] of blocks.entries()) {
    try {
      const result = await mermaid.render(`markda-diagram-${index}-${Date.now()}`, block.textContent ?? '');
      if (renderVersion !== previewRenderVersion) return;
      const container = document.createElement('div');
      container.className = 'markda-diagram';
      container.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      block.parentElement?.replaceWith(container);
    } catch (error) {
      block.parentElement?.classList.add('markda-render-error');
      block.parentElement?.setAttribute('title', String(error));
    }
  }
}

function loadMermaid(): Promise<typeof import('mermaid')['default']> {
  return mermaidPromise ??= import('./mermaidLoader.js').then((module) => module.api);
}

function isDarkMode(): boolean {
  if (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')) return true;
  if (document.body.classList.contains('vscode-light')) return false;
  const bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
  if (bg) {
    const hex = bg.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (hex) {
      const luminance = (0.299 * parseInt(hex[1]!, 16) + 0.587 * parseInt(hex[2]!, 16) + 0.114 * parseInt(hex[3]!, 16)) / 255;
      return luminance < 0.5;
    }
  }
  return false;
}

function initializeMermaid(mermaid: typeof import('mermaid')['default']): void {
  const dark = isDarkMode();
  const fg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground').trim() || (dark ? '#d4d4d4' : '#000000');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    themeVariables: {
      primaryTextColor: fg,
      lineColor: fg,
      textColor: fg,
      mainBkg: dark ? '#2d2d2d' : '#f0f0f0',
      nodeBorder: dark ? '#888' : '#aaa',
    },
  });
}

async function renderLiveMermaid(container: HTMLElement, source: string): Promise<void> {
  try {
    const mermaid = await loadMermaid();
    if (!container.isConnected) return;
    initializeMermaid(mermaid);
    const result = await mermaid.render(`markda-live-${crypto.randomUUID()}`, source);
    if (container.isConnected) container.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
  } catch {
    if (container.isConnected) container.textContent = source;
  }
}

function focusSourcePosition(editor: EditorView, position: number): void {
  editor.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position, { y: 'center' }) });
  editor.focus();
  // Block widgets and their source often have different heights. Re-anchor once
  // after CodeMirror has measured the replacement to avoid a viewport jump.
  requestAnimationFrame(() => editor.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'center' }) }));
}

class LinkWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly label: string, private readonly href: string) { super(); }
  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'markda-live-link';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = this.label;
    link.title = isJapanese ? 'クリックで編集、Ctrl/Cmd+クリックで開く' : 'Click to edit; Ctrl/Cmd+click to open';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) vscode.postMessage({ type: 'openLink', href: this.href });
      else focusSourcePosition(this.editor, this.from);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'markda-link-edit';
    edit.ariaLabel = 'Edit link source';
    edit.title = 'Edit link source';
    edit.textContent = '✎';
    edit.addEventListener('click', () => focusSourcePosition(this.editor, this.from));
    wrapper.append(link, edit);
    return wrapper;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: LinkWidget): boolean { return other.label === this.label && other.href === this.href && other.from === this.from; }
}

class TaskWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly checked: boolean) { super(); }
  toDOM(): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'markda-task-checkbox';
    input.checked = this.checked;
    input.ariaLabel = this.checked ? 'Mark task incomplete' : 'Mark task complete';
    input.addEventListener('change', () => this.editor.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: input.checked ? 'x' : ' ' } }));
    return input;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: TaskWidget): boolean { return other.from === this.from && other.checked === this.checked; }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = 'markda-list-bullet';
    bullet.textContent = '•';
    bullet.setAttribute('aria-hidden', 'true');
    return bullet;
  }
  eq(other: BulletWidget): boolean { return other instanceof BulletWidget; }
}

class ImageWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly alt: string, private readonly source: string) { super(); }
  toDOM(): HTMLElement {
    const figure = document.createElement('figure');
    figure.className = 'markda-live-image';
    figure.tabIndex = 0;
    const image = document.createElement('img');
    image.alt = this.alt;
    if (/^https?:/iu.test(this.source) && settings.security.allowRemoteResources !== 'always') {
      const blocked = document.createElement('span');
      blocked.className = 'markda-remote-blocked';
      blocked.textContent = `Remote image blocked: ${this.alt || this.source}`;
      figure.append(blocked);
    } else {
      try { image.src = /^(?:data:|vscode-webview:)/iu.test(this.source) ? this.source : new URL(this.source, resourceBaseUri).toString(); }
      catch { image.alt = this.alt || this.source; }
      figure.append(image);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = this.alt || 'Image';
    figure.append(caption);
    if (!/^(?:https?:|data:|vscode-webview:)/iu.test(this.source)) {
      const controls = document.createElement('div');
      controls.className = 'markda-image-controls';
      const actions: readonly ['move' | 'copy' | 'delete', string][] = [
        ['move', isJapanese ? '移動・名前変更' : 'Move / Rename'],
        ['copy', isJapanese ? 'コピー' : 'Copy'],
        ['delete', isJapanese ? '削除' : 'Delete'],
      ];
      for (const [action, label] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => vscode.postMessage({ type: 'manageImage', source: this.source, from: this.from, action }));
        controls.append(button);
      }
      figure.append(controls);
    }
    const edit = () => focusSourcePosition(this.editor, this.from);
    figure.addEventListener('dblclick', edit);
    figure.addEventListener('keydown', (event) => { if (event.key === 'Enter') edit(); });
    return figure;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: ImageWidget): boolean { return other.source === this.source && other.alt === this.alt && other.from === this.from; }
}

class CodeBlockWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly source: string, private readonly language: string) { super(); }
  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-live-code';
    const controls = document.createElement('div');
    controls.className = 'markda-code-controls';
    const language = document.createElement('input');
    language.type = 'text';
    language.value = this.language;
    language.placeholder = isJapanese ? '言語' : 'Language';
    language.ariaLabel = isJapanese ? 'コード言語' : 'Code language';
    language.addEventListener('change', () => commitCodeBlock(this.editor, this.from, undefined, language.value.trim()));
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = isJapanese ? 'コピー' : 'Copy';
    copy.addEventListener('click', () => vscode.postMessage({ type: 'copyToClipboard', text: this.source }));
    const editSource = document.createElement('button');
    editSource.type = 'button';
    editSource.textContent = isJapanese ? 'ソース' : 'Source';
    const edit = () => focusSourcePosition(this.editor, this.from);
    editSource.addEventListener('click', edit);
    controls.append(language, copy, editSource);
    container.append(controls);
    if (this.language === 'math' || this.language === 'latex') {
      const rendered = document.createElement('div');
      rendered.className = 'markda-code-rendered';
      rendered.textContent = this.source;
      rendered.tabIndex = 0;
      rendered.addEventListener('dblclick', edit);
      rendered.addEventListener('keydown', (event) => { if (event.key === 'Enter') edit(); });
      container.append(rendered);
      void renderKatexInto(rendered, this.source, true);
    } else if (this.language === 'mermaid' && settings.markdown.diagrams) {
      const rendered = document.createElement('div');
      rendered.className = 'markda-code-rendered';
      rendered.textContent = this.source;
      rendered.tabIndex = 0;
      rendered.addEventListener('dblclick', edit);
      rendered.addEventListener('keydown', (event) => { if (event.key === 'Enter') edit(); });
      container.append(rendered);
      void renderLiveMermaid(rendered, this.source);
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = this.language ? `language-${this.language}` : '';
      code.textContent = this.source;
      code.contentEditable = 'true';
      code.spellcheck = false;
      code.setAttribute('aria-label', isJapanese ? 'コード内容' : 'Code content');
      const gate = new CompositionCommitGate();
      let timer: number | undefined;
      const commit = () => commitCodeBlock(this.editor, this.from, code.textContent ?? '', undefined);
      code.addEventListener('focus', () => { activeCodeFrom = this.from; });
      code.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { timer = undefined; gate.request(commit); }, 80);
      });
      code.addEventListener('compositionstart', () => gate.start());
      code.addEventListener('compositionend', () => gate.end(commit));
      code.addEventListener('keydown', (event) => {
        if (runEditableHistoryShortcut(event, this.editor, () => {
          window.clearTimeout(timer);
          timer = undefined;
          gate.flush(commit);
        })) return;
        if (event.key !== 'Enter' && event.key !== 'Tab') return;
        event.preventDefault();
        insertTextIntoEditable(code, event.key === 'Enter' ? '\n' : '  ');
      });
      code.addEventListener('blur', () => {
        window.clearTimeout(timer);
        gate.flush(commit);
        if (activeCodeFrom === this.from) activeCodeFrom = undefined;
      });
      pre.append(code);
      container.append(pre);
    }
    return container;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: CodeBlockWidget): boolean {
    return other.from === this.from && (activeCodeFrom === this.from || (other.source === this.source && other.language === this.language));
  }
}

function commitCodeBlock(editor: EditorView, from: number, source: string | undefined, language: string | undefined): void {
  const opening = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  const match = opening.text.match(/^(\s*)(```|~~~)\s*([^\s`]*)/u);
  if (!match) return;
  let closing = opening.number + 1;
  const closePattern = new RegExp(`^\\s*${match[2]}\\s*$`, 'u');
  while (closing <= editor.state.doc.lines && !closePattern.test(editor.state.doc.line(closing).text)) closing++;
  if (closing > editor.state.doc.lines) return;
  const changes: { from: number; to: number; insert: string }[] = [];
  if (language !== undefined && language !== (match[3] ?? '')) {
    changes.push({ from: opening.from, to: opening.to, insert: `${match[1] ?? ''}${match[2] ?? '```'}${language}` });
  }
  if (source !== undefined) {
    const closingLine = editor.state.doc.line(closing);
    const { from: contentFrom, to: contentTo } = codeContentRange(editor.state, opening.to, closingLine.from);
    changes.push({ from: contentFrom, to: contentTo, insert: source.replace(/\r?\n$/u, '') });
  }
  if (changes.length) editor.dispatch({ changes });
}

function codeContentRange(state: EditorState, openingTo: number, closingFrom: number): { from: number; to: number } {
  const afterOpening = state.sliceDoc(openingTo, Math.min(state.doc.length, openingTo + 2));
  const openingBreak = afterOpening.startsWith('\r\n') ? 2 : /^[\r\n]/u.test(afterOpening) ? 1 : 0;
  const beforeClosing = state.sliceDoc(Math.max(0, closingFrom - 2), closingFrom);
  const closingBreak = beforeClosing.endsWith('\r\n') ? 2 : /[\r\n]$/u.test(beforeClosing) ? 1 : 0;
  const from = openingTo + openingBreak;
  return { from, to: Math.max(from, closingFrom - closingBreak) };
}

class TableWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly table: MarkdownTable) { super(); }
  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-live-table-wrap';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Editable Markdown table');
    const cellCount = (this.table.rows.length + 1) * this.table.header.length;
    if (cellCount > settings.liveTableMaxCells) {
      container.classList.add('markda-large-table');
      const summary = document.createElement('span');
      summary.textContent = isJapanese
        ? `大きな表（${this.table.rows.length + 1}行 × ${this.table.header.length}列）`
        : `Large table (${this.table.rows.length + 1} rows × ${this.table.header.length} columns)`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = isJapanese ? 'ソースで編集' : 'Edit source';
      edit.addEventListener('click', () => {
        focusSourcePosition(this.editor, this.table.from);
      });
      container.append(summary, edit);
      return container;
    }
    const controls = document.createElement('div');
    controls.className = 'markda-inline-table-controls';
    const actions: readonly [string, () => void][] = [
      [isJapanese ? '+ 行' : '+ Row', () => commitWidgetTable(this.editor, this.table.from, (table) => { table.rows.push(Array.from({ length: table.header.length }, () => '')); })],
      [isJapanese ? '− 行' : '− Row', () => commitWidgetTable(this.editor, this.table.from, (table) => { if (table.rows.length > 1) table.rows.pop(); })],
      [isJapanese ? '+ 列' : '+ Column', () => commitWidgetTable(this.editor, this.table.from, (table) => { table.header.push(''); table.alignments.push('default'); for (const row of table.rows) row.push(''); })],
      [isJapanese ? '− 列' : '− Column', () => commitWidgetTable(this.editor, this.table.from, (table) => { if (table.header.length > 1) { table.header.pop(); table.alignments.pop(); for (const row of table.rows) row.pop(); } })],
      [isJapanese ? 'ソースを編集' : 'Edit source', () => focusSourcePosition(this.editor, this.table.from)],
    ];
    for (const [label, action] of actions) { const button = document.createElement('button'); button.textContent = label; button.type = 'button'; button.addEventListener('click', action); controls.append(button); }
    container.append(controls);
    const tableElement = document.createElement('table');
    [this.table.header, ...this.table.rows].forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.draggable = rowIndex > 0;
      row.forEach((cell, column) => {
        const element = document.createElement(rowIndex === 0 ? 'th' : 'td');
        element.contentEditable = 'true';
        element.spellcheck = true;
        element.textContent = cell;
        element.style.textAlign = this.table.alignments[column] === 'default' ? '' : this.table.alignments[column] ?? '';
        if (rowIndex === 0) {
          element.draggable = true;
          element.dataset.column = String(column);
          element.title = 'Right-click to change alignment; drag to reorder';
          element.addEventListener('contextmenu', (event) => { event.preventDefault(); this.cycleAlignment(column); });
        }
        const commitGate = new CompositionCommitGate();
        let commitTimer: number | undefined;
        const commit = () => this.updateCell(rowIndex - 1, column, element.textContent ?? '');
        const scheduleCommit = () => {
          window.clearTimeout(commitTimer);
          commitTimer = window.setTimeout(() => { commitTimer = undefined; commitGate.request(commit); }, 80);
        };
        element.addEventListener('focus', () => { activeTableFrom = this.table.from; });
        element.addEventListener('input', scheduleCommit);
        element.addEventListener('compositionstart', () => commitGate.start());
        element.addEventListener('compositionend', () => commitGate.end(commit));
        element.addEventListener('blur', () => {
          window.clearTimeout(commitTimer);
          commitGate.flush(commit);
          if (activeTableFrom === this.table.from) activeTableFrom = undefined;
        });
        element.addEventListener('keydown', (event) => {
          if (runEditableHistoryShortcut(event, this.editor, () => {
            window.clearTimeout(commitTimer);
            commitTimer = undefined;
            commitGate.flush(commit);
          })) return;
          navigateEditableCell(event, container);
        });
        tr.append(element);
      });
      tr.addEventListener('dragstart', (event) => { if (rowIndex > 0) event.dataTransfer?.setData('application/x-markda-row', String(rowIndex - 1)); });
      tr.addEventListener('dragover', (event) => event.preventDefault());
      tr.addEventListener('drop', (event) => {
        const source = Number(event.dataTransfer?.getData('application/x-markda-row'));
        if (Number.isInteger(source) && rowIndex > 0) this.moveRow(source, rowIndex - 1);
      });
      tableElement.append(tr);
    });
    tableElement.querySelectorAll<HTMLTableCellElement>('th').forEach((header) => {
      header.addEventListener('dragstart', (event) => event.dataTransfer?.setData('application/x-markda-column', header.dataset.column ?? ''));
      header.addEventListener('dragover', (event) => event.preventDefault());
      header.addEventListener('drop', (event) => {
        const source = Number(event.dataTransfer?.getData('application/x-markda-column'));
        const target = Number(header.dataset.column);
        if (Number.isInteger(source) && Number.isInteger(target)) this.moveColumn(source, target);
      });
    });
    container.append(tableElement);
    return container;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: TableWidget): boolean {
    return other.table.from === this.table.from
      && (activeTableFrom === this.table.from || serializeMarkdownTable(other.table) === serializeMarkdownTable(this.table));
  }
  private updateCell(row: number, column: number, value: string): void {
    const clean = value.replaceAll('|', '\\|').replace(/\s*[\r\n]+\s*/gu, ' ').trim();
    commitWidgetTable(this.editor, this.table.from, (table) => {
      if (row < 0) table.header[column] = clean;
      else if (table.rows[row]) table.rows[row]![column] = clean;
    });
  }
  private moveRow(source: number, target: number): void {
    if (source === target) return;
    commitWidgetTable(this.editor, this.table.from, (table) => { const [row] = table.rows.splice(source, 1); if (row) table.rows.splice(target, 0, row); });
  }
  private moveColumn(source: number, target: number): void {
    if (source === target) return;
    commitWidgetTable(this.editor, this.table.from, (table) => {
      moveArrayItem(table.header, source, target);
      moveArrayItem(table.alignments, source, target);
      for (const row of table.rows) moveArrayItem(row, source, target);
    });
  }
  private cycleAlignment(column: number): void {
    const order: TableAlignment[] = ['default', 'left', 'center', 'right'];
    commitWidgetTable(this.editor, this.table.from, (table) => { table.alignments[column] = order[(order.indexOf(table.alignments[column] ?? 'default') + 1) % order.length] ?? 'default'; });
  }
}

function moveArrayItem<T>(values: T[], source: number, target: number): void {
  const [value] = values.splice(source, 1);
  if (value !== undefined) values.splice(target, 0, value);
}

function navigateEditableCell(event: KeyboardEvent, container: HTMLElement): void {
  if ((event.ctrlKey || event.metaKey) && formatEditableSelection(event)) return;
  if (event.key !== 'Tab' && event.key !== 'Enter') return;
  const cells = Array.from(container.querySelectorAll<HTMLElement>('th,td'));
  const current = cells.indexOf(event.currentTarget as HTMLElement);
  const next = cells[current + (event.key === 'Tab' && event.shiftKey ? -1 : 1)];
  if (next) { event.preventDefault(); next.focus(); }
  else if (event.key === 'Enter') event.preventDefault();
}

function runEditableHistoryShortcut(event: KeyboardEvent, editor: EditorView, flush: () => void): boolean {
  const command = historyShortcut(event);
  if (!command) return false;
  event.preventDefault();
  // Commit the latest DOM value before popping history. This also covers the
  // debounce window immediately after a keystroke. Blurring makes the widget
  // rebuild from the restored Markdown instead of retaining stale DOM text.
  flush();
  (event.currentTarget as HTMLElement | null)?.blur();
  (command === 'undo' ? undo : redo)(editor);
  editor.focus();
  return true;
}

function formatEditableSelection(event: KeyboardEvent): boolean {
  const key = event.key.toLocaleLowerCase();
  const markers: readonly [string, string] | undefined = key === 'b' ? ['**', '**'] : key === 'i' ? ['*', '*']
    : key === 'k' ? ['[', ']()'] : event.shiftKey && event.key === '`' ? ['`', '`'] : undefined;
  if (!markers) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement) || !target.contains(range.commonAncestorContainer)) return false;
  event.preventDefault();
  const selected = range.toString();
  const inserted = document.createTextNode(`${markers[0]}${selected}${markers[1]}`);
  range.deleteContents();
  range.insertNode(inserted);
  const next = document.createRange();
  next.setStart(inserted, markers[0].length);
  next.setEnd(inserted, markers[0].length + selected.length);
  selection.removeAllRanges();
  selection.addRange(next);
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  return true;
}

function commitWidgetTable(editor: EditorView, from: number, mutate: (table: MarkdownTable) => void): void {
  const source = editor.state.doc.toString();
  const table = findMarkdownTable(source, from, editor.state.doc.lineAt(from).number - 1);
  if (!table) return;
  const copy: MarkdownTable = { ...table, header: [...table.header], alignments: [...table.alignments], rows: table.rows.map((row) => [...row]) };
  mutate(copy);
  editor.dispatch({ changes: { from: table.from, to: table.to, insert: serializeMarkdownTable(copy, source.includes('\r\n') ? '\r\n' : '\n') } });
}

class MathWidget extends WidgetType {
  constructor(private readonly source: string, private readonly displayMode: boolean = false) { super(); }
  toDOM(): HTMLElement {
    const element = document.createElement(this.displayMode ? 'div' : 'span');
    element.className = this.displayMode ? 'markda-block-math' : 'markda-inline-math';
    if (katexInstance) {
      try {
        katexInstance.render(this.source, element, { displayMode: this.displayMode, throwOnError: false, strict: 'warn', trust: false });
      } catch (error) {
        element.classList.add('markda-render-error');
        element.textContent = String(error);
      }
    } else {
      element.textContent = this.source;
      void renderKatexInto(element, this.source, this.displayMode);
    }
    return element;
  }
  eq(other: MathWidget): boolean { return other.source === this.source && other.displayMode === this.displayMode; }
}

class CalloutWidget extends WidgetType {
  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly type: string,
    private readonly content: string,
  ) { super(); }
  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = `markda-callout markda-callout-${this.type.toLowerCase()}`;
    container.setAttribute('role', 'note');
    container.setAttribute('aria-label', this.type.charAt(0).toUpperCase() + this.type.slice(1));
    const title = document.createElement('div');
    title.className = 'markda-callout-title';
    title.textContent = this.type.charAt(0).toUpperCase() + this.type.slice(1);
    container.append(title);
    const content = document.createElement('div');
    content.className = 'markda-callout-content';
    content.textContent = this.content;
    container.append(content);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'markda-callout-edit';
    edit.textContent = isJapanese ? '編集' : 'Edit';
    edit.addEventListener('click', () => focusSourcePosition(this.editor, this.from));
    container.append(edit);
    return container;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: CalloutWidget): boolean {
    return other.from === this.from && other.type === this.type && other.content === this.content;
  }
}

function createLivePreviewPlugin() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private applyingBlockRefresh = false;
    private blockRefreshQueued = false;
    constructor(editor: EditorView) {
      // Widget classes are declared later in this module and are still in their
      // temporal dead zone while EditorView itself is being constructed. Build
      // after module evaluation completes; otherwise CodeMirror catches the
      // ReferenceError and permanently disables the whole live-preview plugin.
      this.decorations = Decoration.none;
      requestAnimationFrame(() => {
        editor.dispatch({ effects: refreshLivePreview.of(null) });
      });
    }
    update(update: ViewUpdate): void {
      const modeChanged = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setMode)));
      const refreshRequested = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshLivePreview)));
      // Inline source markers are revealed only while the selection intersects
      // them, so moving within one line must refresh the decorations as well.
      // Block decorations (table / code-block / image widgets) are written into
      // `blockDecorationsField` here, because CodeMirror forbids exposing block
      // decorations from a view plugin's `decorations` property —doing so throws
      // "Block decorations may not be specified via plugins" and corrupts editing.
      // The block update is deferred to a microtask so we never dispatch from
      // inside CodeMirror's own update cycle (which would recurse / drop the
      // inline decorations computed just above).
      // Rebuild block widgets only when the caret crosses a line boundary. Doing it
      // for every selection update needlessly toggles block DOM while moving within
      // a line, but never rebuilding leaves an edited block permanently as source.
      const selectionLineChanged = update.selectionSet
        && update.startState.doc.lineAt(update.startState.selection.main.head).number
          !== update.state.doc.lineAt(update.state.selection.main.head).number;
      const inlineNeedsUpdate = update.docChanged || update.viewportChanged || modeChanged || refreshRequested || update.selectionSet;
      if (inlineNeedsUpdate) {
        this.decorations = buildInlineDecorations(update.view);
        if ((update.docChanged || update.viewportChanged || modeChanged || refreshRequested || selectionLineChanged)
          && !this.applyingBlockRefresh && !this.blockRefreshQueued) {
          this.blockRefreshQueued = true;
          queueMicrotask(() => {
            this.blockRefreshQueued = false;
            if (!update.view.dom.isConnected) return;
            this.applyingBlockRefresh = true;
            try {
              update.view.dispatch({ effects: setBlockDecorations.of(buildBlockDecorations(update.view)) });
            } finally {
              this.applyingBlockRefresh = false;
            }
          });
        }
      }
    }
  }, { decorations: (plugin) => plugin.decorations });
}

function buildInlineDecorations(editor: EditorView): DecorationSet {
  const decorations: { from: number; to?: number; decoration: Decoration }[] = [];
  const state = editor.state.field(modeField);
  const selection = editor.state.selection.main;
  let documentSource: string | undefined;
  const activeLine = editor.state.doc.lineAt(selection.head).number;
  const focusLines = state.focusMode ? activeFocusLines(editor, activeLine) : { from: 1, to: editor.state.doc.lines };
  let processedUntil = -1;
  for (const range of editor.visibleRanges) {
    const firstLine = editor.state.doc.lineAt(range.from).number;
    const lastLine = editor.state.doc.lineAt(range.to).number;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
      const line = editor.state.doc.line(lineNumber);
      if (line.from < processedUntil) continue;
      // visibleRanges can meet or overlap on a line boundary. Applying the same
      // replacement twice duplicates the rendered text and exposes hidden syntax.
      processedUntil = line.to + 1;
      const text = line.text;
      // Skip block math ($$ ... $$) ranges: the block-decoration pass already
      // replaces them with a widget, so the inline pass must not also touch them.
      if (/^\s*\$\$\s*$/u.test(text)) {
        let endLine = lineNumber + 1;
        while (endLine <= editor.state.doc.lines && !/^\s*\$\$\s*$/u.test(editor.state.doc.line(endLine).text)) {
          endLine++;
        }
        if (endLine <= editor.state.doc.lines) {
          processedUntil = editor.state.doc.line(endLine).to + 1;
          continue;
        }
      }
      const heading = text.match(/^(#{1,6})([ \t]+)(?=\S)/u);
      const quote = text.match(/^(>[ \t]?)/u);
      const list = text.match(/^(\s*)([-+*]|\d+[.)])(\s+)/u);
      if (heading) decorations.push({ from: line.from, decoration: Decoration.line({ class: `markda-h${heading[1]?.length ?? 1}` }) });
      if (quote) decorations.push({ from: line.from, decoration: Decoration.line({ class: 'markda-quote' }) });
      if (state.focusMode && (lineNumber < focusLines.from || lineNumber > focusLines.to)) decorations.push({ from: line.from, decoration: Decoration.line({ class: 'markda-unfocused' }) });
      if (!state.sourceMode) {
        const task = text.match(/^(\s*[-+*]\s+)\[([ xX])\](\s+)/u);
        if (task) {
          const from = line.from + (task[1]?.length ?? 0);
          decorations.push({ from, to: from + 3, decoration: Decoration.replace({ widget: new TaskWidget(editor, from, (task[2] ?? ' ') !== ' ') }) });
        }
        if (heading && !selectionIntersects(selection.from, selection.to, line.from, line.from + heading[0].length)) {
          hide(decorations, line.from, line.from + heading[0].length);
        }
        if (quote && !selectionIntersects(selection.from, selection.to, line.from, line.from + quote[0].length)) {
          hide(decorations, line.from, line.from + quote[0].length);
        }
        if (list && !/^\s*[-+*]\s+\[[ xX]\]/u.test(text)) {
          const markerFrom = line.from + (list[1]?.length ?? 0);
          const markerTo = markerFrom + (list[2]?.length ?? 0);
          if (selectionIntersects(selection.from, selection.to, markerFrom, markerTo)) {
            decorations.push({ from: markerFrom, to: markerTo, decoration: Decoration.mark({ class: 'markda-list-marker' }) });
          } else if (/^[-+*]$/u.test(list[2] ?? '')) {
            decorations.push({ from: markerFrom, to: markerTo, decoration: Decoration.replace({ widget: new BulletWidget() }) });
          } else {
            decorations.push({ from: markerFrom, to: markerTo, decoration: Decoration.mark({ class: 'markda-list-marker' }) });
          }
        }
        addInlineDecorations(decorations, editor, line.from, text, selection.from, selection.to);
      } else {
        addSourceLinkDecorations(decorations, line.from, text);
      }
    }
  }
  return Decoration.set(decorations.map((item) => item.decoration.range(item.from, item.to ?? item.from)), true);
}

/**
 * Block-level widgets (tables, fenced code blocks, images) for the live preview.
 * Kept separate from `buildInlineDecorations` because these are block decorations,
 * which CodeMirror only accepts from a state field (`blockDecorationsField`), not
 * from a view plugin's `decorations` property.
 */
function buildBlockDecorations(editor: EditorView): DecorationSet {
  const decorations: { from: number; to?: number; decoration: Decoration }[] = [];
  const state = editor.state.field(modeField);
  const selection = editor.state.selection.main;
  let documentSource: string | undefined;
  if (state.sourceMode) return Decoration.none;
  let processedUntil = -1;
  for (const range of editor.visibleRanges) {
    const firstLine = editor.state.doc.lineAt(range.from).number;
    const lastLine = editor.state.doc.lineAt(range.to).number;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
      const line = editor.state.doc.line(lineNumber);
      if (line.from < processedUntil) continue;
      processedUntil = line.to + 1;
      const text = line.text;
      // Block math: a line that is exactly "$$" (or "$$" with trailing spaces)
      // opens a multi-line math block that closes at the next "$$" line.
      const blockMathOpen = /^\s*\$\$\s*$/u.test(text);
      if (blockMathOpen) {
        let endLine = lineNumber + 1;
        while (endLine <= editor.state.doc.lines && !/^\s*\$\$\s*$/u.test(editor.state.doc.line(endLine).text)) {
          endLine++;
        }
        if (endLine <= editor.state.doc.lines) {
          const from = line.from;
          const to = editor.state.doc.line(endLine).to;
          // Always render the block math as a widget so the raw $$ delimiters
          // and source are never shown alongside the rendered formula.
          const source = editor.state.sliceDoc(line.to + 1, editor.state.doc.line(endLine).from);
          decorations.push({ from, to, decoration: Decoration.replace({ widget: new MathWidget(source, true), block: true }) });
          processedUntil = to + 1;
          continue;
        }
      }
      const table = text.includes('|') ? findMarkdownTable(documentSource ??= editor.state.doc.toString(), line.from, lineNumber - 1) : undefined;
      if (table && (selection.head < table.from || selection.head > table.to)) {
        decorations.push({ from: table.from, to: table.to, decoration: Decoration.replace({ widget: new TableWidget(editor, table), block: true }) });
        processedUntil = table.to;
        continue;
      }
      const fence = text.match(/^\s*(```|~~~)\s*([^\s`~]*)/u);
      if (fence) {
        let endLine = lineNumber;
        const closeFence = new RegExp(`^\\s*${fence[1]}\\s*$`, 'u');
        while (endLine < editor.state.doc.lines && !closeFence.test(editor.state.doc.line(endLine + 1).text)) endLine++;
        if (endLine < editor.state.doc.lines) endLine++;
        const end = editor.state.doc.line(endLine).to;
        if (selection.head < line.from || selection.head > end) {
          const contentRange = codeContentRange(editor.state, line.to, editor.state.doc.line(endLine).from);
          const contentFrom = contentRange.from;
          const contentTo = contentRange.to;
          decorations.push({ from: line.from, to: end, decoration: Decoration.replace({ widget: new CodeBlockWidget(editor, line.from, editor.state.sliceDoc(contentFrom, Math.max(contentFrom, contentTo)), fence[2] ?? ''), block: true }) });
          processedUntil = end;
          continue;
        }
      }
      const image = text.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/u);
      if (image && lineNumber !== editor.state.doc.lineAt(selection.head).number) {
        decorations.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: new ImageWidget(editor, line.from, image[1] ?? '', image[2] ?? ''), block: true }) });
      }
      // GitHub Alert (Callout), with the older bold-label form retained for compatibility.
      const calloutMatch = text.match(/^>\s*(?:\[!(Note|Tip|Important|Warning|Caution)\]|\*\*(Note|Tip|Important|Warning|Caution)\*\*)\s*$/iu);
      if (calloutMatch && (selection.head < line.from || selection.head > line.to)) {
        const rawCalloutType = (calloutMatch[1] ?? calloutMatch[2])!;
        const calloutType = `${rawCalloutType[0]?.toUpperCase() ?? ''}${rawCalloutType.slice(1).toLowerCase()}`;
        let endLine = lineNumber;
        // Include subsequent blockquote lines as part of the callout
        while (endLine + 1 <= editor.state.doc.lines && /^>(?:\s|$)/u.test(editor.state.doc.line(endLine + 1).text)) {
          endLine++;
        }
        const end = editor.state.doc.line(endLine).to;
        const contentLines: string[] = [];
        for (let i = lineNumber + 1; i <= endLine; i++) {
          const l = editor.state.doc.line(i);
          contentLines.push(l.text.replace(/^>\s?/u, ''));
        }
        const content = contentLines.join('\n').trim();
        decorations.push({ from: line.from, to: end, decoration: Decoration.replace({ widget: new CalloutWidget(editor, line.from, calloutType, content), block: true }) });
        processedUntil = end;
        continue;
      }
    }
  }
  if (decorations.length === 0) return Decoration.none;
  return Decoration.set(decorations.map((item) => item.decoration.range(item.from, item.to ?? item.from)), true);
}

function selectionIntersects(selectionFrom: number, selectionTo: number, from: number, to: number): boolean {
  return selectionFrom === selectionTo
    ? selectionFrom >= from && selectionFrom < to
    : selectionTo > from && selectionFrom < to;
}

function addSourceLinkDecorations(
  output: { from: number; to?: number; decoration: Decoration }[], lineFrom: number, text: string,
): void {
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\([^)\n]+\)/gu)) {
    const from = lineFrom + (match.index ?? 0);
    output.push({
      from,
      to: from + match[0].length,
      decoration: Decoration.mark({ class: 'markda-source-link' }),
    });
  }
}

function activeFocusLines(editor: EditorView, activeLine: number): { from: number; to: number } {
  const active = editor.state.doc.line(activeLine);
  const table = active.text.includes('|') ? findMarkdownTable(editor.state.doc.toString(), active.from, activeLine - 1) : undefined;
  if (table) return { from: table.startLine + 1, to: table.endLine + 1 };
  let from = activeLine;
  let to = activeLine;
  while (from > 1 && editor.state.doc.line(from - 1).text.trim()) from--;
  while (to < editor.state.doc.lines && editor.state.doc.line(to + 1).text.trim()) to++;
  return { from, to };
}

function addInlineDecorations(
  output: { from: number; to?: number; decoration: Decoration }[], editor: EditorView,
  lineFrom: number, text: string, selectionFrom: number, selectionTo: number,
): void {
  const linkRanges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (selectionIntersects(selectionFrom, selectionTo, start, end)) continue;
    const rawHref = (match[2] ?? '').trim();
    const href = rawHref.match(/^<([^>]+)>/u)?.[1] ?? rawHref.match(/^\S+/u)?.[0] ?? rawHref;
    linkRanges.push({ start, end });
    output.push({ from: start, to: end, decoration: Decoration.replace({ widget: new LinkWidget(editor, start, match[1] ?? '', href) }) });
  }
  const patterns: readonly [RegExp, string, number][] = [
    [/(\*\*|__)(?=\S)(.+?\S)\1/gu, 'markda-strong', 2],
    [/(?<!\*)\*(?!\*)(?=\S)(.+?\S)(?<!\*)\*(?!\*)/gu, 'markda-emphasis', 1],
    [/~~(?=\S)(.+?\S)~~/gu, 'markda-strike', 2],
    [/==(?=\S)(.+?\S)==/gu, 'markda-highlight', 2],
    [/`([^`]+)`/gu, 'markda-code', 1],
  ];
  for (const [pattern, className, markerLength] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = lineFrom + (match.index ?? 0);
      const end = start + match[0].length;
      if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
      if (selectionIntersects(selectionFrom, selectionTo, start, end)) continue;
      hide(output, start, start + markerLength);
      hide(output, end - markerLength, end);
      output.push({ from: start + markerLength, to: end - markerLength, decoration: Decoration.mark({ class: className }) });
    }
  }
  for (const match of text.matchAll(/\$([^$\n]+)\$/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    if (selectionIntersects(selectionFrom, selectionTo, start, end)) continue;
    output.push({ from: start, to: end, decoration: Decoration.replace({ widget: new MathWidget(match[1] ?? '') }) });
  }
}

function hide(output: { from: number; to?: number; decoration: Decoration }[], from: number, to: number): void {
  // Use a mark (not a widget replacement) so the source markers keep their
  // original width on screen. A replace widget would shift CodeMirror's
  // coordinate mapping and make click/click-to-cursor offsets drift — worst
  // further down the document. The markers are simply painted transparent.
  if (to > from) output.push({ from, to, decoration: Decoration.mark({ class: 'markda-hide-marker' }) });
}

function getStyles(): string { return String.raw`
  .markda-live-link a,.markda-source-link,#preview a{color:var(--vscode-textLink-foreground,#4daafc);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}.markda-live-link a:hover,#preview a:hover{color:var(--vscode-textLink-activeForeground,#75beff)}.markda-link-edit{min-height:18px;padding:0 3px;margin-left:2px;opacity:0}.markda-live-link:hover .markda-link-edit,.markda-link-edit:focus{opacity:1}
  .markda-image-controls{display:flex;justify-content:center;gap:4px;margin-top:4px}.markda-image-controls button{font-size:12px;min-height:24px}
:root{--markda-content-width:860px}*{box-sizing:border-box}html,body,#app{height:100%;margin:0}body{overflow:hidden;color:var(--markda-fg,var(--vscode-editor-foreground));background:var(--markda-bg,var(--vscode-editor-background));font-family:var(--vscode-font-family)}
  button{color:inherit;background:transparent;border:0;border-radius:4px;min-height:28px;padding:4px 8px;cursor:pointer}button:hover{background:var(--vscode-toolbar-hoverBackground)}button.active{background:var(--vscode-toolbar-activeBackground,var(--vscode-list-activeSelectionBackground))}button:focus-visible,[tabindex]:focus-visible,[contenteditable]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
  .markda-shell{height:100%;display:grid;grid-template-rows:auto auto 1fr auto}.markda-toolbar{min-height:36px;padding:4px 10px;display:flex;align-items:center;gap:2px;border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto}.markda-toolbar button{display:flex;gap:5px;align-items:center;flex:0 0 auto}.toolbar-separator{height:18px;border-left:1px solid var(--vscode-panel-border);margin:0 5px}.toolbar-spacer{flex:1}.math-icon{font:bold 17px serif}.table-toolbar{display:none;min-height:34px;padding:3px 10px;align-items:center;gap:2px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);overflow-x:auto}.table-active .table-toolbar{display:flex}.table-toolbar>span:first-child{font-weight:600;margin-right:6px}.table-toolbar button{display:flex;gap:4px;align-items:center}.table-toolbar button:disabled{opacity:.4;cursor:default}
.markda-workspace{display:grid;grid-template-columns:minmax(0,1fr);min-height:0}.preview-visible .markda-workspace{grid-template-columns:minmax(0,1fr) minmax(320px,42%)}#editor,#preview{min-width:0;overflow:auto}#preview{display:none;border-left:1px solid var(--vscode-panel-border);padding:30px;line-height:1.65}.preview-visible #preview{display:block}
.cm-editor{min-height:100%;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);background:transparent}.cm-editor.cm-focused{outline:none}.cm-scroller{padding:34px var(--markda-padding-x,24px) 90px;line-height:1.7}.cm-content{max-width:var(--markda-content-width);margin:0;caret-color:var(--vscode-editorCursor-foreground,var(--markda-cursor-color,#000))}.cm-line{padding:2px 0;transition:opacity .12s}.cm-activeLine{background:var(--vscode-editor-lineHighlightBackground,#ffffff0a)}.cm-cursor,.cm-dropCursor{border-left:2px solid var(--markda-cursor-color,#000)!important;margin-left:-1px}.cm-selectionBackground{background:var(--vscode-editor-selectionBackground)!important}
.markda-h1{font-size:2em;font-weight:650;line-height:1.25;margin-top:.7em}.markda-h2{font-size:1.55em;font-weight:650;line-height:1.3;margin-top:.6em;border-bottom:1px solid var(--vscode-panel-border)}.markda-h3{font-size:1.3em;font-weight:650}.markda-h4,.markda-h5,.markda-h6{font-weight:650}.markda-quote{border-left:4px solid var(--vscode-textBlockQuote-border);padding-left:14px!important;color:var(--vscode-descriptionForeground)}.markda-list-marker{color:var(--vscode-symbolIcon-arrayForeground)}.markda-list-bullet{display:inline-block;min-width:.8em;color:var(--vscode-editor-foreground);font-weight:700;text-align:center}
  .markda-strong{font-weight:700}.markda-emphasis{font-style:italic}.markda-strike{text-decoration:line-through}.markda-highlight{background:var(--vscode-editor-findMatchHighlightBackground);border-radius:2px}.markda-code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px}.markda-inline-math{padding:0 2px}.markda-unfocused{opacity:.22}.source-mode .markda-h1,.source-mode .markda-h2,.source-mode .markda-h3{font-size:inherit;font-weight:inherit;border:0;margin:0}.source-mode .markda-unfocused{opacity:1}
  .markda-task-checkbox{margin:0 6px 0 1px;vertical-align:baseline;width:1em;height:1em}.markda-live-image{margin:12px 0;max-width:100%;width:max-content;overflow:auto;border:1px solid transparent;border-radius:6px;padding:6px}.markda-live-image:hover{border-color:var(--vscode-panel-border)}.markda-live-image img{display:block;max-width:100%;max-height:70vh}.markda-live-image figcaption{text-align:center;color:var(--vscode-descriptionForeground);font-size:.9em}.markda-live-code{margin:10px 0;max-width:100%;overflow:auto}.markda-code-controls{display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:4px}.markda-code-controls input{min-width:70px;width:110px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:3px 5px}.markda-code-controls button{font-size:12px;min-height:24px}.markda-live-code pre{margin:0;padding:14px;border-radius:5px;background:var(--vscode-textCodeBlock-background)}.markda-live-code code[contenteditable]{display:block;min-height:1.5em;white-space:pre;outline:none}.markda-code-rendered{padding:10px}.markda-live-table-wrap{overflow:auto;margin:12px 0}.markda-inline-table-controls{display:flex;gap:4px;justify-content:flex-end;margin-bottom:4px}.markda-inline-table-controls button{font-size:12px;min-height:24px}.markda-live-table-wrap table{border-collapse:collapse;width:100%}.markda-live-table-wrap th,.markda-live-table-wrap td{border:1px solid var(--vscode-panel-border);padding:7px 10px;min-width:70px;resize:horizontal;overflow:auto}.markda-live-table-wrap th{background:var(--vscode-sideBar-background)}
  .markda-large-table{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border:1px solid var(--vscode-panel-border);border-radius:5px;color:var(--vscode-descriptionForeground)}
  .markda-callout{margin:12px 0;padding:12px 16px;border-radius:6px;border-left:4px solid;background:var(--vscode-editor-background)}.markda-callout-title{font-weight:600;margin-bottom:4px}.markda-callout-content{color:var(--vscode-editor-foreground)}.markda-callout-edit{margin-top:8px;font-size:11px;padding:2px 8px;opacity:0}.markda-callout:hover .markda-callout-edit{opacity:1}
  .markda-callout-note{border-color:var(--vscode-editorInfo-border,#007acc);background:var(--vscode-editorInfo-background,#e8f4fd)}.markda-callout-note .markda-callout-title{color:var(--vscode-editorInfo-foreground,#007acc)}
  .markda-callout-tip{border-color:var(--vscode-editorInfo-border,#89d185);background:var(--vscode-editorInfo-background,#e8f8e8)}.markda-callout-tip .markda-callout-title{color:var(--vscode-editorInfo-foreground,#89d185)}
  .markda-callout-important{border-color:var(--vscode-editorWarning-border,#cca700);background:var(--vscode-editorWarning-background,#fff8e8)}.markda-callout-important .markda-callout-title{color:var(--vscode-editorWarning-foreground,#cca700)}
  .markda-callout-warning{border-color:var(--vscode-editorWarning-border,#e8a000);background:var(--vscode-editorWarning-background,#fff3e0)}.markda-callout-warning .markda-callout-title{color:var(--vscode-editorWarning-foreground,#e8a000)}
  .markda-callout-caution{border-color:var(--vscode-editorError-border,#f14c4c);background:var(--vscode-editorError-background,#fde8e8)}.markda-callout-caution .markda-callout-title{color:var(--vscode-editorError-foreground,#f14c4c)}

  dialog{color:var(--vscode-editorWidget-foreground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:7px;box-shadow:0 8px 28px #0007}dialog::backdrop{background:#0007}dialog form{display:grid;gap:14px;min-width:260px}dialog h2{font-size:16px;margin:0}dialog label{display:flex;justify-content:space-between;gap:20px;align-items:center}dialog input{width:76px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:5px}dialog form>div{display:flex;justify-content:flex-end;gap:8px}
  body[data-markda-theme="paper"] .cm-content{font-family:Georgia,"Times New Roman",serif}body[data-markda-theme="midnight"]{--markda-accent:#7aa2f7}body[data-markda-theme="midnight"] .markda-h1,body[data-markda-theme="midnight"] .markda-h2{color:var(--markda-accent)}
#preview h1,#preview h2,#preview h3{line-height:1.25;margin-top:1.5em}#preview h2{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:.25em}#preview pre{overflow:auto;padding:14px;background:var(--vscode-textCodeBlock-background);border-radius:5px}#preview code{font-family:var(--vscode-editor-font-family)}#preview blockquote{margin-left:0;padding-left:1em;border-left:4px solid var(--vscode-textBlockQuote-border);color:var(--vscode-descriptionForeground)}#preview table{border-collapse:collapse;width:100%}#preview th,#preview td{border:1px solid var(--vscode-panel-border);padding:6px 10px}#preview img{max-width:100%}.markda-render-error{color:var(--vscode-errorForeground)}.markda-remote-blocked{display:inline-block;padding:8px 10px;border:1px dashed var(--vscode-panel-border);color:var(--vscode-descriptionForeground)}
  @media(max-width:760px){.markda-toolbar button span:not(.math-icon){display:none}.preview-visible .markda-workspace{grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(180px,1fr)}#preview{border-left:0;border-top:1px solid var(--vscode-panel-border)}.cm-scroller{padding-left:20px;padding-right:20px}}
  .markda-hide-marker{color:transparent}.markda-hide-marker::selection{color:var(--vscode-editor-foreground)}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`; }
