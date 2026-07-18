import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import '@vscode/codicons/dist/codicon.css';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import DOMPurify from 'dompurify';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';
import mermaid from 'mermaid';
import type {
  DocumentStatistics, EditorCommand, EditorSettings, EditorToHostMessage, Heading, HostToEditorMessage,
} from '../protocol.js';
import { getStatistics } from '../statistics.js';
import { findMinimalChange } from '../textChange.js';
import {
  addTableColumn, addTableRow, alignTableColumn, deleteTableColumn, deleteTableRow,
  findMarkdownTable, serializeMarkdownTable, tableCursor, type MarkdownTable, type TableAlignment,
} from '../table.js';

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: EditorToHostMessage): void;
  getState(): T | undefined;
  setState(state: T): void;
};

interface ViewState {
  sourceMode: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  previewVisible: boolean;
}

const vscode = acquireVsCodeApi<ViewState>();
const isJapanese = navigator.language.toLocaleLowerCase().startsWith('ja');
const initialViewState: ViewState = vscode.getState() ?? {
  sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: false,
};
const externalUpdate = Annotation.define<boolean>();
const setMode = StateEffect.define<Partial<ViewState>>();
const modeField = StateField.define<ViewState>({
  create: () => initialViewState,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setMode)) value = { ...value, ...effect.value };
    return value;
  },
});

let documentUri = '';
let resourceBaseUri = '';
let themeBaseUri = '';
let documentVersion = 0;
let syncedText = '';
let inFlightTransaction: string | undefined;
let sendTimer: number | undefined;
let previewTimer: number | undefined;
let previewRenderVersion = 0;
let clientRenderer: MarkdownIt | undefined;
let cachedDocumentText = '';
let cachedTable: MarkdownTable | undefined;
let settings: EditorSettings = {
  contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
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
  <footer class="markda-footer"><div id="statistics-panel" role="dialog" aria-label="Document statistics" hidden></div><button id="statistics" title="Document statistics" aria-haspopup="dialog" aria-expanded="false"></button><span id="sync-state" aria-live="polite">Ready</span></footer>
</div>`;

const appRoot = document.querySelector<HTMLElement>('.markda-shell')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
const statisticsButton = document.querySelector<HTMLButtonElement>('#statistics')!;
const syncState = document.querySelector<HTMLElement>('#sync-state')!;
const statisticsPanel = document.querySelector<HTMLElement>('#statistics-panel')!;
const tableDialog = document.querySelector<HTMLDialogElement>('#table-dialog')!;
document.querySelectorAll<HTMLButtonElement>('button[title]').forEach((button) => {
  if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title);
});
document.querySelectorAll<HTMLElement>('.toolbar-separator').forEach((separator) => separator.setAttribute('aria-hidden', 'true'));
if (isJapanese) localizeStaticUi();

const view = new EditorView({
  parent: document.querySelector<HTMLElement>('#editor')!,
  state: EditorState.create({
    doc: '',
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
      createLivePreviewPlugin(),
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

document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
  button.addEventListener('click', () => runCommand(button.dataset.command as EditorCommand));
});
document.querySelectorAll<HTMLButtonElement>('[data-table-command]').forEach((button) => {
  button.addEventListener('click', () => runTableCommand(button.dataset.tableCommand ?? ''));
});
document.querySelector('#preview-button')?.addEventListener('click', () => togglePreview());
statisticsButton.addEventListener('click', () => toggleStatistics());
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideStatistics(); });
document.querySelector('#table-insert-confirm')?.addEventListener('click', () => insertTableFromDialog());
view.dom.addEventListener('paste', (event) => void receiveImageFiles(event.clipboardData?.files, event));
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
  window.clearTimeout(sendTimer);
  window.clearTimeout(previewTimer);
});
applyViewState(initialViewState);
vscode.postMessage({ type: 'ready' });

function onHostMessage(message: HostToEditorMessage): void {
  switch (message.type) {
    case 'initialize':
      documentUri = message.uri;
      resourceBaseUri = message.resourceBaseUri;
      themeBaseUri = message.themeBaseUri;
      documentVersion = message.version;
      settings = message.settings;
      syncedText = message.text;
      if (!replaceDocument(message.text)) updateDocumentDerivedState();
      applySettings();
      return;
    case 'documentChanged':
      documentVersion = message.version;
      syncedText = message.text;
      if (message.sourceTransactionId && message.sourceTransactionId === inFlightTransaction) {
        inFlightTransaction = undefined;
        syncState.textContent = 'Saved in buffer';
        scheduleEdit();
      } else {
        inFlightTransaction = undefined;
        replaceDocument(message.text);
        syncState.textContent = 'Updated externally';
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
    scheduleEdit();
  }
  if (update.docChanged) updateDocumentDerivedState();
  else if (update.selectionSet) {
    updateTableToolbar();
    updateStatistics();
    const state = update.state.field(modeField);
    vscode.postMessage({ type: 'state', sourceMode: state.sourceMode, focusMode: state.focusMode, typewriterMode: state.typewriterMode, cursor: update.state.selection.main.head });
  }
  const mode = update.state.field(modeField);
  if (mode.typewriterMode && update.selectionSet && settings.typewriterKeepCentered) {
    view.dispatch({ effects: EditorView.scrollIntoView(update.state.selection.main.head, { y: 'center' }) });
  }
}

function scheduleEdit(): void {
  window.clearTimeout(sendTimer);
  sendTimer = window.setTimeout(flushEdit, 35);
}

function flushEdit(): void {
  if (inFlightTransaction) return;
  const current = view.state.doc.toString();
  if (current === syncedText) return;
  const change = findMinimalChange(syncedText, current);
  inFlightTransaction = crypto.randomUUID();
  syncState.textContent = 'Syncing…';
  vscode.postMessage({
    type: 'edit', uri: documentUri, baseVersion: documentVersion, transactionId: inFlightTransaction,
    changes: [change], selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
  });
}

function replaceDocument(text: string): boolean {
  if (view.state.doc.toString() === text) return false;
  const position = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(position),
    annotations: externalUpdate.of(true),
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
      statisticsButton.title = `${stat.words} words · ${stat.characters} characters · ${stat.lines} lines · ${stat.readingMinutes} min read`;
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
    case 'toggleTaskList':
      toggleLinePrefix('- [ ] ');
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
  document.documentElement.style.setProperty('--markda-content-width', `${settings.contentWidth}px`);
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  const themeName = (dark ? settings.theme.dark : settings.theme.light).replace(/[^a-zA-Z0-9._-]/gu, '');
  document.body.dataset.markdaTheme = themeName;
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

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

function updateStatistics(): void { renderStatistics(calculateStatistics()); }

function renderStatistics(stat: DocumentStatistics): void {
  const selected = stat.selectionCharacters > 0
    ? `<dt>${isJapanese ? '選択範囲' : 'Selection'}</dt><dd>${stat.selectionWords} ${isJapanese ? '語' : 'words'} · ${stat.selectionCharacters} ${isJapanese ? '文字' : 'characters'}</dd>` : '';
  statisticsPanel.innerHTML = `<dl>${selected}<dt>${isJapanese ? '単語数' : 'Words'}</dt><dd>${stat.words}</dd><dt>${isJapanese ? '文字数' : 'Characters'}</dt><dd>${stat.characters}</dd><dt>${isJapanese ? '空白を除く文字数' : 'Without spaces'}</dt><dd>${stat.charactersWithoutSpaces}</dd><dt>${isJapanese ? '行数' : 'Lines'}</dt><dd>${stat.lines}</dd><dt>${isJapanese ? '読了時間' : 'Reading time'}</dt><dd>${stat.readingMinutes} ${isJapanese ? '分' : 'min'}</dd></dl>`;
  statisticsButton.textContent = stat.selectionCharacters > 0 ? `${stat.selectionWords} ${isJapanese ? '語を選択' : 'selected'}` : `${stat.words} ${isJapanese ? '語' : 'words'}`;
  statisticsButton.title = `${stat.words} words · ${stat.characters} characters · ${stat.lines} lines · ${stat.readingMinutes} min read`;
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

function toggleStatistics(): void {
  statisticsPanel.hidden = !statisticsPanel.hidden;
  statisticsButton.setAttribute('aria-expanded', String(!statisticsPanel.hidden));
}

function hideStatistics(): void {
  statisticsPanel.hidden = true;
  statisticsButton.setAttribute('aria-expanded', 'false');
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
  const headings = extractHeadings(source);
  const stat = getStatistics(source);
  statisticsButton.textContent = `${stat.words} words`;
  renderStatistics(stat);
  vscode.postMessage({ type: 'outline', headings });
  vscode.postMessage({ type: 'statistics', statistics: stat });
  const mode = view.state.field(modeField);
  vscode.postMessage({ type: 'state', sourceMode: mode.sourceMode, focusMode: mode.focusMode, typewriterMode: mode.typewriterMode, cursor: view.state.selection.main.head });
  updateTableToolbar(source);
  if (view.state.field(modeField).previewVisible) schedulePreviewRender();
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

function createMarkdaKeymap() {
  return [
    { key: 'Tab', run: (editor: EditorView) => navigateTableCell(editor, false) },
    { key: 'Shift-Tab', run: (editor: EditorView) => navigateTableCell(editor, true) },
    { key: 'Mod-b', run: (editor: EditorView) => wrapSelection(editor, '**', '**') },
    { key: 'Mod-i', run: (editor: EditorView) => wrapSelection(editor, '*', '*') },
    { key: 'Mod-k', run: (editor: EditorView) => wrapLink(editor) },
    { key: 'Mod-Shift-`', run: (editor: EditorView) => wrapSelection(editor, '`', '`') },
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `Mod-${index + 1}`,
      run: (editor: EditorView) => setHeading(editor, index + 1),
    })),
    { key: 'Mod-0', run: (editor: EditorView) => setHeading(editor, 0) },
  ];
}

function updateTableToolbar(source = cachedDocumentText): void {
  const position = view.state.selection.main.head;
  // Almost every cursor move is outside a table. Avoid materializing and splitting
  // the complete document unless the active line can actually be a table row.
  if (!view.state.doc.lineAt(position).text.includes('|')) {
    appRoot.classList.remove('table-active');
    return;
  }
  const table = cachedTable && position >= cachedTable.from && position <= cachedTable.to
    ? cachedTable
    : findMarkdownTable(source, position);
  cachedTable = table;
  appRoot.classList.toggle('table-active', Boolean(table));
  const cursor = table ? tableCursor(source, table, position) : undefined;
  document.querySelector<HTMLButtonElement>('[data-table-command="row-delete"]')!.disabled = !table || (cursor?.row ?? -1) < 0;
  document.querySelector<HTMLButtonElement>('[data-table-command="column-delete"]')!.disabled = !table || table.header.length <= 1;
}

function runTableCommand(command: string): void {
  const source = view.state.doc.toString();
  const table = findMarkdownTable(source, view.state.selection.main.head);
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
  const reparsed = findMarkdownTable(view.state.doc.toString(), original.from);
  if (reparsed) {
    const position = tableCellPosition(view.state, reparsed, row, column);
    view.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position) });
  }
  view.focus();
}

function navigateTableCell(editor: EditorView, backwards: boolean): boolean {
  const source = editor.state.doc.toString();
  const table = findMarkdownTable(source, editor.state.selection.main.head);
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
  previewTimer = window.setTimeout(renderPreview, 120);
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
  renderer.renderer.rules.markda_math_inline = (tokens, index) => renderKatex(tokens[index]?.content ?? '', false);
  const defaultFence = renderer.renderer.rules.fence;
  renderer.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token?.info.trim() === 'math') return renderKatex(token.content, true);
    return defaultFence
      ? defaultFence(tokens, index, options, env, self)
      : `<pre><code>${renderer.utils.escapeHtml(token?.content ?? '')}</code></pre>\n`;
  };
}

function prepareMarkdownForPreview(source: string): string {
  if (!settings.markdown.math) return source;
  return source.replace(/^\$\$[ \t]*\r?\n([\s\S]*?)\r?\n\$\$[ \t]*$/gmu, (_match, expression: string) => `\`\`\`math\n${expression}\n\`\`\``);
}

function renderKatex(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, { displayMode, throwOnError: false, strict: 'warn', trust: false });
  } catch (error) {
    return `<span class="markda-render-error">${String(error)}</span>`;
  }
}

async function renderMermaidBlocks(renderVersion: number): Promise<void> {
  if (!settings.markdown.diagrams) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.body.classList.contains('vscode-dark') ? 'dark' : 'default' });
  const blocks = Array.from(preview.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
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

class LinkWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly label: string, private readonly href: string) { super(); }
  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'markda-live-link';
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = this.label;
    link.title = this.href;
    link.addEventListener('click', (event) => { event.preventDefault(); vscode.postMessage({ type: 'openLink', href: this.href }); });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'markda-link-edit';
    edit.ariaLabel = 'Edit link source';
    edit.title = 'Edit link source';
    edit.textContent = '✎';
    edit.addEventListener('click', () => { this.editor.dispatch({ selection: EditorSelection.cursor(this.from) }); this.editor.focus(); });
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
    const edit = () => { this.editor.dispatch({ selection: EditorSelection.cursor(this.from), effects: EditorView.scrollIntoView(this.from) }); this.editor.focus(); };
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
    container.tabIndex = 0;
    container.title = 'Double-click or press Enter to edit source';
    if (this.language === 'math' || this.language === 'latex') {
      container.innerHTML = DOMPurify.sanitize(renderKatex(this.source, true));
    } else if (this.language === 'mermaid' && settings.markdown.diagrams) {
      container.textContent = this.source;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.body.classList.contains('vscode-dark') ? 'dark' : 'default' });
      void mermaid.render(`markda-live-${crypto.randomUUID()}`, this.source).then((result) => {
        container.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      }).catch(() => { container.textContent = this.source; });
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = this.language ? `language-${this.language}` : '';
      code.textContent = this.source;
      pre.append(code);
      container.append(pre);
    }
    const edit = () => { this.editor.dispatch({ selection: EditorSelection.cursor(this.from) }); this.editor.focus(); };
    container.addEventListener('dblclick', edit);
    container.addEventListener('keydown', (event) => { if (event.key === 'Enter') edit(); });
    return container;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: CodeBlockWidget): boolean { return other.from === this.from && other.source === this.source && other.language === this.language; }
}

class TableWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly table: MarkdownTable) { super(); }
  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-live-table-wrap';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Editable Markdown table');
    const controls = document.createElement('div');
    controls.className = 'markda-inline-table-controls';
    const actions: readonly [string, () => void][] = [
      [isJapanese ? '+ 行' : '+ Row', () => commitWidgetTable(this.editor, this.table.from, (table) => { table.rows.push(Array.from({ length: table.header.length }, () => '')); })],
      [isJapanese ? '− 行' : '− Row', () => commitWidgetTable(this.editor, this.table.from, (table) => { if (table.rows.length > 1) table.rows.pop(); })],
      [isJapanese ? '+ 列' : '+ Column', () => commitWidgetTable(this.editor, this.table.from, (table) => { table.header.push(''); table.alignments.push('default'); for (const row of table.rows) row.push(''); })],
      [isJapanese ? '− 列' : '− Column', () => commitWidgetTable(this.editor, this.table.from, (table) => { if (table.header.length > 1) { table.header.pop(); table.alignments.pop(); for (const row of table.rows) row.pop(); } })],
      [isJapanese ? 'ソースを編集' : 'Edit source', () => { this.editor.dispatch({ selection: EditorSelection.cursor(this.table.from) }); this.editor.focus(); }],
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
        element.addEventListener('blur', () => this.updateCell(rowIndex - 1, column, element.textContent ?? ''));
        element.addEventListener('keydown', (event) => navigateEditableCell(event, container));
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
  eq(other: TableWidget): boolean { return other.table.from === this.table.from && serializeMarkdownTable(other.table) === serializeMarkdownTable(this.table); }
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
  if (event.key !== 'Tab') return;
  const cells = Array.from(container.querySelectorAll<HTMLElement>('th,td'));
  const current = cells.indexOf(event.currentTarget as HTMLElement);
  const next = cells[current + (event.shiftKey ? -1 : 1)];
  if (next) { event.preventDefault(); next.focus(); }
}

function commitWidgetTable(editor: EditorView, from: number, mutate: (table: MarkdownTable) => void): void {
  const source = editor.state.doc.toString();
  const table = findMarkdownTable(source, from);
  if (!table) return;
  const copy: MarkdownTable = { ...table, header: [...table.header], alignments: [...table.alignments], rows: table.rows.map((row) => [...row]) };
  mutate(copy);
  editor.dispatch({ changes: { from: table.from, to: table.to, insert: serializeMarkdownTable(copy, source.includes('\r\n') ? '\r\n' : '\n') } });
}

class MathWidget extends WidgetType {
  constructor(private readonly source: string) { super(); }
  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'markda-inline-math';
    katex.render(this.source, element, { throwOnError: false, trust: false });
    return element;
  }
  eq(other: MathWidget): boolean { return other.source === this.source; }
}

function createLivePreviewPlugin() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(editor: EditorView) { this.decorations = buildDecorations(editor); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged
        || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setMode)))) {
        this.decorations = buildDecorations(update.view);
      }
    }
  }, { decorations: (plugin) => plugin.decorations });
}

function buildDecorations(editor: EditorView): DecorationSet {
  const decorations: { from: number; to?: number; decoration: Decoration }[] = [];
  const state = editor.state.field(modeField);
  const selection = editor.state.selection.main;
  const documentSource = editor.state.doc.toString();
  const activeLine = editor.state.doc.lineAt(selection.head).number;
  const focusLines = activeFocusLines(editor, activeLine);
  let processedUntil = -1;
  for (const range of editor.visibleRanges) {
    const firstLine = editor.state.doc.lineAt(range.from).number;
    const lastLine = editor.state.doc.lineAt(range.to).number;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
      const line = editor.state.doc.line(lineNumber);
      if (line.from < processedUntil) continue;
      const text = line.text;
      const heading = text.match(/^(#{1,6})([ \t]+)/u);
      const quote = text.match(/^(>[ \t]?)/u);
      const list = text.match(/^(\s*)(?:[-+*]|\d+[.)])([ \t]+)/u);
      if (!state.sourceMode) {
        const table = text.includes('|') ? findMarkdownTable(documentSource, line.from) : undefined;
        if (table && (selection.head < table.from || selection.head > table.to)) {
          decorations.push({ from: table.from, to: table.to, decoration: Decoration.replace({ widget: new TableWidget(editor, table), block: true }) });
          processedUntil = table.to;
          continue;
        }
        const fence = text.match(/^\s*```\s*([^\s`]*)/u);
        if (fence) {
          let endLine = lineNumber;
          while (endLine < editor.state.doc.lines && !/^\s*```\s*$/u.test(editor.state.doc.line(endLine + 1).text)) endLine++;
          if (endLine < editor.state.doc.lines) endLine++;
          const end = editor.state.doc.line(endLine).to;
          if (selection.head < line.from || selection.head > end) {
            const contentFrom = line.to + 1;
            const contentTo = editor.state.doc.line(endLine).from - 1;
            decorations.push({ from: line.from, to: end, decoration: Decoration.replace({ widget: new CodeBlockWidget(editor, line.from, editor.state.sliceDoc(contentFrom, Math.max(contentFrom, contentTo)), fence[1] ?? ''), block: true }) });
            processedUntil = end;
            continue;
          }
        }
        const image = text.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/u);
        if (image && lineNumber !== activeLine) {
          decorations.push({ from: line.from, to: line.to, decoration: Decoration.replace({ widget: new ImageWidget(editor, line.from, image[1] ?? '', image[2] ?? ''), block: true }) });
          continue;
        }
        const task = text.match(/^(\s*[-+*]\s+)\[([ xX])\](\s+)/u);
        if (task) {
          const from = line.from + (task[1]?.length ?? 0);
          decorations.push({ from, to: from + 3, decoration: Decoration.replace({ widget: new TaskWidget(editor, from, (task[2] ?? ' ') !== ' ') }) });
        }
      }
      if (heading) decorations.push({ from: line.from, decoration: Decoration.line({ class: `markda-h${heading[1]?.length ?? 1}` }) });
      if (quote) decorations.push({ from: line.from, decoration: Decoration.line({ class: 'markda-quote' }) });
      if (state.focusMode && (lineNumber < focusLines.from || lineNumber > focusLines.to)) decorations.push({ from: line.from, decoration: Decoration.line({ class: 'markda-unfocused' }) });
      if (!state.sourceMode && lineNumber !== activeLine) {
        if (heading) hide(decorations, line.from, line.from + heading[0].length);
        if (quote) hide(decorations, line.from, line.from + quote[0].length);
        if (list && !/^\s*[-+*]\s+\[[ xX]\]/u.test(text)) {
          const markerFrom = line.from + (list[1]?.length ?? 0);
          decorations.push({ from: markerFrom, to: line.from + list[0].length, decoration: Decoration.mark({ class: 'markda-list-marker' }) });
        }
        addInlineDecorations(decorations, line.from, text, selection.from, selection.to);
      }
    }
  }
  return Decoration.set(decorations.map((item) => item.decoration.range(item.from, item.to ?? item.from)), true);
}

function activeFocusLines(editor: EditorView, activeLine: number): { from: number; to: number } {
  const active = editor.state.doc.line(activeLine);
  const table = active.text.includes('|') ? findMarkdownTable(editor.state.doc.toString(), active.from) : undefined;
  if (table) return { from: table.startLine + 1, to: table.endLine + 1 };
  let from = activeLine;
  let to = activeLine;
  while (from > 1 && editor.state.doc.line(from - 1).text.trim()) from--;
  while (to < editor.state.doc.lines && editor.state.doc.line(to + 1).text.trim()) to++;
  return { from, to };
}

function addInlineDecorations(
  output: { from: number; to?: number; decoration: Decoration }[], lineFrom: number, text: string, selectionFrom: number, selectionTo: number,
): void {
  const linkRanges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (selectionTo >= start && selectionFrom <= end) continue;
    const rawHref = (match[2] ?? '').trim();
    const href = rawHref.match(/^<([^>]+)>/u)?.[1] ?? rawHref.match(/^\S+/u)?.[0] ?? rawHref;
    linkRanges.push({ start, end });
    output.push({ from: start, to: end, decoration: Decoration.replace({ widget: new LinkWidget(view, start, match[1] ?? '', href) }) });
  }
  const patterns: readonly [RegExp, string, number][] = [
    [/(\*\*|__)(?=\S)(.+?\S)\1/gu, 'markda-strong', 2],
    [/(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/gu, 'markda-emphasis', 1],
    [/~~(?=\S)(.+?\S)~~/gu, 'markda-strike', 2],
    [/==(?=\S)(.+?\S)==/gu, 'markda-highlight', 2],
    [/`([^`]+)`/gu, 'markda-code', 1],
  ];
  for (const [pattern, className, markerLength] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = lineFrom + (match.index ?? 0);
      const end = start + match[0].length;
      if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
      if (selectionTo >= start && selectionFrom <= end) continue;
      hide(output, start, start + markerLength);
      hide(output, end - markerLength, end);
      output.push({ from: start + markerLength, to: end - markerLength, decoration: Decoration.mark({ class: className }) });
    }
  }
  for (const match of text.matchAll(/\$([^$\n]+)\$/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    if (selectionTo >= start && selectionFrom <= end) continue;
    output.push({ from: start, to: end, decoration: Decoration.replace({ widget: new MathWidget(match[1] ?? '') }) });
  }
}

function hide(output: { from: number; to?: number; decoration: Decoration }[], from: number, to: number): void {
  if (to > from) output.push({ from, to, decoration: Decoration.replace({}) });
}

function getStyles(): string { return String.raw`
  .markda-live-link a{color:var(--vscode-textLink-foreground);text-decoration:underline}.markda-link-edit{min-height:18px;padding:0 3px;margin-left:2px;opacity:0}.markda-live-link:hover .markda-link-edit,.markda-link-edit:focus{opacity:1}
  .markda-image-controls{display:flex;justify-content:center;gap:4px;margin-top:4px}.markda-image-controls button{font-size:12px;min-height:24px}
:root{--markda-content-width:860px}*{box-sizing:border-box}html,body,#app{height:100%;margin:0}body{overflow:hidden;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}
  button{color:inherit;background:transparent;border:0;border-radius:4px;min-height:28px;padding:4px 8px;cursor:pointer}button:hover{background:var(--vscode-toolbar-hoverBackground)}button.active{background:var(--vscode-toolbar-activeBackground,var(--vscode-list-activeSelectionBackground))}button:focus-visible,[tabindex]:focus-visible,[contenteditable]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
  .markda-shell{height:100%;display:grid;grid-template-rows:auto auto 1fr auto}.markda-toolbar{min-height:36px;padding:4px 10px;display:flex;align-items:center;gap:2px;border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto}.markda-toolbar button{display:flex;gap:5px;align-items:center;flex:0 0 auto}.toolbar-separator{height:18px;border-left:1px solid var(--vscode-panel-border);margin:0 5px}.toolbar-spacer{flex:1}.math-icon{font:bold 17px serif}.table-toolbar{display:none;min-height:34px;padding:3px 10px;align-items:center;gap:2px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);overflow-x:auto}.table-active .table-toolbar{display:flex}.table-toolbar>span:first-child{font-weight:600;margin-right:6px}.table-toolbar button{display:flex;gap:4px;align-items:center}.table-toolbar button:disabled{opacity:.4;cursor:default}
.markda-workspace{display:grid;grid-template-columns:minmax(0,1fr);min-height:0}.preview-visible .markda-workspace{grid-template-columns:minmax(0,1fr) minmax(320px,42%)}#editor,#preview{min-width:0;overflow:auto}#preview{display:none;border-left:1px solid var(--vscode-panel-border);padding:30px;line-height:1.65}.preview-visible #preview{display:block}
.cm-editor{min-height:100%;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);background:transparent}.cm-editor.cm-focused{outline:none}.cm-scroller{padding:34px max(24px,calc((100% - var(--markda-content-width))/2)) 90px;line-height:1.7}.cm-content{max-width:var(--markda-content-width);margin:0 auto;caret-color:var(--vscode-editorCursor-foreground)}.cm-line{padding:2px 0;transition:opacity .12s}.cm-selectionBackground{background:var(--vscode-editor-selectionBackground)!important}
.markda-h1{font-size:2em;font-weight:650;line-height:1.25;margin-top:.7em}.markda-h2{font-size:1.55em;font-weight:650;line-height:1.3;margin-top:.6em;border-bottom:1px solid var(--vscode-panel-border)}.markda-h3{font-size:1.3em;font-weight:650}.markda-h4,.markda-h5,.markda-h6{font-weight:650}.markda-quote{border-left:4px solid var(--vscode-textBlockQuote-border);padding-left:14px!important;color:var(--vscode-descriptionForeground)}.markda-list-marker{color:var(--vscode-symbolIcon-arrayForeground)}
  .markda-strong{font-weight:700}.markda-emphasis{font-style:italic}.markda-strike{text-decoration:line-through}.markda-highlight{background:var(--vscode-editor-findMatchHighlightBackground);border-radius:2px}.markda-code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px}.markda-inline-math{padding:0 2px}.markda-unfocused{opacity:.22}.source-mode .markda-h1,.source-mode .markda-h2,.source-mode .markda-h3{font-size:inherit;font-weight:inherit;border:0;margin:0}.source-mode .markda-unfocused{opacity:1}
  .markda-task-checkbox{margin:0 6px 0 1px;vertical-align:middle}.markda-live-image{margin:12px 0;max-width:100%;width:max-content;resize:both;overflow:auto;border:1px solid transparent;border-radius:6px;padding:6px}.markda-live-image:hover{border-color:var(--vscode-panel-border)}.markda-live-image img{display:block;max-width:100%;max-height:70vh}.markda-live-image figcaption{text-align:center;color:var(--vscode-descriptionForeground);font-size:.9em}.markda-live-code{margin:10px 0;max-width:100%;overflow:auto}.markda-live-code pre{margin:0;padding:14px;border-radius:5px;background:var(--vscode-textCodeBlock-background)}.markda-live-table-wrap{overflow:auto;margin:12px 0}.markda-inline-table-controls{display:flex;gap:4px;justify-content:flex-end;margin-bottom:4px}.markda-inline-table-controls button{font-size:12px;min-height:24px}.markda-live-table-wrap table{border-collapse:collapse;width:100%}.markda-live-table-wrap th,.markda-live-table-wrap td{border:1px solid var(--vscode-panel-border);padding:7px 10px;min-width:70px;resize:horizontal;overflow:auto}.markda-live-table-wrap th{background:var(--vscode-sideBar-background)}
  .markda-footer{height:24px;padding:0 10px;display:flex;align-items:center;justify-content:flex-end;gap:12px;color:var(--vscode-statusBar-foreground);background:var(--vscode-statusBar-background);font-size:12px;position:relative}.markda-footer button{font-size:12px;min-height:20px;padding:0 4px}#statistics-panel{position:absolute;right:8px;bottom:28px;z-index:10;min-width:250px;padding:12px;color:var(--vscode-editorWidget-foreground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);box-shadow:0 4px 14px #0005;border-radius:6px}#statistics-panel[hidden]{display:none}#statistics-panel dl{display:grid;grid-template-columns:1fr auto;gap:6px 16px;margin:0}#statistics-panel dt{color:var(--vscode-descriptionForeground)}#statistics-panel dd{margin:0;text-align:right}
  dialog{color:var(--vscode-editorWidget-foreground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:7px;box-shadow:0 8px 28px #0007}dialog::backdrop{background:#0007}dialog form{display:grid;gap:14px;min-width:260px}dialog h2{font-size:16px;margin:0}dialog label{display:flex;justify-content:space-between;gap:20px;align-items:center}dialog input{width:76px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:5px}dialog form>div{display:flex;justify-content:flex-end;gap:8px}
  body[data-markda-theme="paper"] .cm-content{font-family:Georgia,"Times New Roman",serif}body[data-markda-theme="midnight"]{--markda-accent:#7aa2f7}body[data-markda-theme="midnight"] .markda-h1,body[data-markda-theme="midnight"] .markda-h2{color:var(--markda-accent)}
#preview h1,#preview h2,#preview h3{line-height:1.25;margin-top:1.5em}#preview h2{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:.25em}#preview pre{overflow:auto;padding:14px;background:var(--vscode-textCodeBlock-background);border-radius:5px}#preview code{font-family:var(--vscode-editor-font-family)}#preview blockquote{margin-left:0;padding-left:1em;border-left:4px solid var(--vscode-textBlockQuote-border);color:var(--vscode-descriptionForeground)}#preview table{border-collapse:collapse;width:100%}#preview th,#preview td{border:1px solid var(--vscode-panel-border);padding:6px 10px}#preview img{max-width:100%}.markda-render-error{color:var(--vscode-errorForeground)}.markda-remote-blocked{display:inline-block;padding:8px 10px;border:1px dashed var(--vscode-panel-border);color:var(--vscode-descriptionForeground)}
  @media(max-width:760px){.markda-toolbar button span:not(.math-icon){display:none}.preview-visible .markda-workspace{grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(180px,1fr)}#preview{border-left:0;border-top:1px solid var(--vscode-panel-border)}.cm-scroller{padding-left:20px;padding-right:20px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`; }
