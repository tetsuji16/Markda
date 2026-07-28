import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import '@vscode/codicons/dist/codicon.css';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, ChangeSet, EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, highlightActiveLine, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import DOMPurify from 'dompurify';
import { decodeHTML } from 'entities';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';
import { light as lightEmojiPlugin } from 'markdown-it-emoji';
import lightEmojiNames from 'markdown-it-emoji/lib/data/light.mjs';
import type {
  DocumentStatistics, EditorCommand, EditorDiagnostic, EditorSettings, EditorToHostMessage, Heading, HostToEditorMessage, TextChange,
} from '../protocol.js';
import {
  collectMathReferences, headingAnchors, installDocumentFeatures, prepareMathExpression,
} from '../markdownFeatures.js';
import { analyzeDocument, getStatistics } from '../statistics.js';
import { findMinimalChange } from '../textChange.js';
import { translate } from '../localization.js';
import {
  addTableColumn, addTableRow, alignTableColumn, deleteTableColumn, deleteTableRow,
  findMarkdownTable, serializeMarkdownTable, tableCursor, type MarkdownTable, type TableAlignment,
} from '../table.js';
import {
  CompositionCommitGate, documentLineSeparator, editablePlainText, historyShortcut, htmlFragmentToMarkdown, liveEnterEdit,
  markdownPairDeletion, markdownPairEdit, normalizeDocumentText, serializedDocumentOffset, serializeDocumentText,
  type DocumentLineSeparator, type TextEdit,
} from './editorLogic.js';

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
const locale = initialDocument?.locale ?? 'en';
const t = (key: Parameters<typeof translate>[1], ...values: readonly (string | number)[]) => translate(locale, key, ...values);

const vscode = acquireVsCodeApi<ViewState>();
const savedViewState = vscode.getState();
// v1 could strand the editor in source mode without a clear visual indication.
// Reset that legacy state once; states saved by this version remain persistent.
const initialViewState: ViewState = savedViewState?.schemaVersion === 2 ? savedViewState : {
  schemaVersion: 2, sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: false,
};
const externalUpdate = Annotation.define<boolean>();
const setMode = StateEffect.define<Partial<ViewState>>();
const refreshLivePreview = StateEffect.define<null>();
const refreshInlinePreview = StateEffect.define<null>();
const settleLivePreview = StateEffect.define<number>();
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
let assetBaseUri = initialDocument?.assetBaseUri ?? '';
let documentVersion = initialDocument?.version ?? 0;
let syncedText = initialDocument?.text ?? '';
let inFlightTransaction: string | undefined;
let inFlightChanges: readonly TextChange[] | undefined;
let pendingChanges: ChangeSet | undefined;
let pendingBaseText: string | undefined;
let pendingLineSeparator: DocumentLineSeparator | undefined;
let lineSeparator = documentLineSeparator(syncedText);
let sendTimer: number | undefined;
let previewTimer: number | undefined;
let derivedStateTimer: number | undefined;
let suppressStateUntil = 0;
let previewRenderVersion = 0;
let clientRenderer: MarkdownIt | undefined;
let mermaidPromise: Promise<typeof import('mermaid')['default']> | undefined;
let katexPromise: Promise<typeof import('katex')['default']> | undefined;
let katexStylesPromise: Promise<void> | undefined;
let katexInstance: typeof import('katex')['default'] | undefined;
let yamlPromise: Promise<typeof import('yaml')> | undefined;
let emojiPromise: Promise<void> | undefined;
let emojiPlugin = lightEmojiPlugin;
let emojiNames: Readonly<Record<string, string>> = lightEmojiNames;
let cachedDocumentText = '';
let cachedTable: MarkdownTable | undefined;
let activeTableFrom: number | undefined;
let activeLiveTableCursor: { from: number; row: number; column: number } | undefined;
let activeCodeFrom: number | undefined;
let activeImageFrom: number | undefined;
let activeMathFrom: number | undefined;
let activeCalloutFrom: number | undefined;
let activeHtmlFrom: number | undefined;
let activeFrontMatterFrom: number | undefined;
let currentDiagnostics: readonly EditorDiagnostic[] = [];
let linkDialogSelection: { from: number; to: number } | undefined;
let mathReferenceCache: { source: string; references: ReturnType<typeof collectMathReferences> } | undefined;
let referenceDefinitionCache: {
  doc: EditorState['doc'];
  definitions: ReadonlyMap<string, MarkdownReferenceDefinition>;
} | undefined;
let beginLivePreviewFreeze: ((editor: EditorView) => void) | undefined;
let colorThemeRevision = 0;
const nestedEditableFlushers = new WeakMap<HTMLElement, () => void>();

let settings: EditorSettings = initialDocument?.settings ?? {
  contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true, previewUpdateDelay: 500, liveTableMaxCells: 600,
  themeMode: 'auto',
  markdown: { math: true, diagrams: true, html: true, breaks: false },
  security: { allowRemoteResources: 'prompt', allowUnsafeHtml: false },
  theme: { light: 'paper', dark: 'midnight' },
};
function usesDarkColors(): boolean {
  return settings.themeMode === 'dark'
    || (settings.themeMode === 'auto'
      && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')));
}

/**
 * Keep CodeMirror source highlighting and rendered code widgets on the same
 * theme contract. CSS variables resolve at paint time, so selected themes and
 * user theme files update both surfaces without rebuilding editor state.
 */
function createSyntaxHighlightStyle(): HighlightStyle {
  return HighlightStyle.define([
    { tag: [tags.meta, tags.comment], color: 'var(--markda-syntax-comment)' },
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--markda-syntax-keyword)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--markda-syntax-string)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--markda-syntax-constant)' },
    { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--markda-syntax-entity)' },
    { tag: [tags.variableName, tags.propertyName, tags.labelName], color: 'var(--markda-syntax-variable)' },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: 'var(--markda-syntax-entity)' },
    { tag: [tags.heading, tags.strong], fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: [tags.link, tags.url], color: 'var(--markda-link)', textDecoration: 'underline' },
    { tag: tags.invalid, color: 'var(--markda-error)' },
  ]);
}

document.body.innerHTML = `<style>${getStyles()}</style>
<div class="markda-shell">
  <header id="editor-toolbar" class="markda-toolbar" aria-label="${t('editorControls')}">
    <button id="toolbar-toggle" title="${t('showControls')}" aria-label="${t('showControls')}" aria-controls="editor-toolbar" aria-expanded="false"><i class="codicon codicon-more" aria-hidden="true"></i></button>
    <button data-command="toggleSourceMode" title="${t('sourceMode')}" aria-label="${t('toggleSourceMode')}" aria-pressed="false"><i class="codicon codicon-code" aria-hidden="true"></i><span>${t('source')}</span></button>
    <button data-command="toggleFocusMode" title="${t('focusMode')}" aria-label="${t('toggleFocusMode')}" aria-pressed="false"><i class="codicon codicon-target" aria-hidden="true"></i><span>${t('focus')}</span></button>
    <button data-command="toggleTypewriterMode" title="${t('typewriterMode')}" aria-label="${t('toggleTypewriterMode')}" aria-pressed="false"><i class="codicon codicon-move" aria-hidden="true"></i><span>${t('typewriter')}</span></button>
    <span class="toolbar-separator"></span>
    <label class="markda-style-picker"><span class="visually-hidden">${t('paragraphStyle')}</span><select id="paragraph-style" title="${t('paragraphStyle')}" aria-label="${t('paragraphStyle')}">
      <option value="0">${t('paragraph')}</option>${Array.from({ length: 6 }, (_value, index) => `<option value="${index + 1}">${t('heading', index + 1)}</option>`).join('')}
    </select></label>
    <button data-command="toggleBold" title="${t('bold')} (Ctrl+B)" aria-label="${t('bold')}"><i class="codicon codicon-bold" aria-hidden="true"></i></button>
    <button data-command="toggleItalic" title="${t('italic')} (Ctrl+I)" aria-label="${t('italic')}"><i class="codicon codicon-italic" aria-hidden="true"></i></button>
    <button data-command="toggleInlineCode" title="${t('inlineCode')}" aria-label="${t('inlineCode')}"><i class="codicon codicon-code" aria-hidden="true"></i></button>
    <button data-command="insertLink" title="${t('insertLink')} (Ctrl+K)" aria-label="${t('insertLink')}"><i class="codicon codicon-link" aria-hidden="true"></i></button>
    <button data-command="toggleBulletList" title="${t('bulletedList')}" aria-label="${t('bulletedList')}"><i class="codicon codicon-list-unordered" aria-hidden="true"></i></button>
    <button data-command="toggleOrderedList" title="${t('orderedList')}" aria-label="${t('orderedList')}"><i class="codicon codicon-list-ordered" aria-hidden="true"></i></button>
    <button data-command="toggleTaskList" title="${t('taskList')}" aria-label="${t('taskList')}"><i class="codicon codicon-checklist" aria-hidden="true"></i></button>
    <button data-command="toggleBlockquote" title="${t('blockquote')}" aria-label="${t('blockquote')}"><i class="codicon codicon-quote"></i></button>
    <button data-command="toggleStrikethrough" title="${t('strikethrough')}" aria-label="${t('strikethrough')}"><span aria-hidden="true"><s>S</s></span></button>
    <button data-command="insertCodeBlock" title="${t('codeBlock')}" aria-label="${t('codeBlock')}"><i class="codicon codicon-symbol-method"></i></button>
    <button data-command="clearFormatting" title="${t('clearFormatting')}" aria-label="${t('clearFormatting')}"><i class="codicon codicon-clear-all"></i></button>
    <span class="toolbar-separator"></span>
    <button data-command="insertTable" title="${t('insertTable')}" aria-label="${t('insertTable')}"><i class="codicon codicon-table" aria-hidden="true"></i></button>
    <button data-command="insertImage" title="${t('insertImages')}" aria-label="${t('insertImages')}"><i class="codicon codicon-file-media" aria-hidden="true"></i></button>
    <button data-command="insertMathBlock" title="${t('insertMath')}" aria-label="${t('insertMath')}"><span class="math-icon" aria-hidden="true">∑</span></button>
    <span class="toolbar-spacer"></span>
    <button id="theme-toggle" title="${t('toggleTheme')}" aria-label="${t('toggleTheme')}"><i class="codicon codicon-color-mode" aria-hidden="true"></i><span>${t('theme')}</span></button>
  </header>
  <div id="table-toolbar" class="table-toolbar" aria-label="${t('tableControls')}">
    <span>${t('table')}</span>
    <button data-table-command="row-before" title="${t('rowBefore')}"><i class="codicon codicon-arrow-up"></i> ${t('row')}</button>
    <button data-table-command="row-after" title="${t('rowAfter')}"><i class="codicon codicon-arrow-down"></i> ${t('row')}</button>
    <button data-table-command="row-delete" title="${t('deleteRow')}"><i class="codicon codicon-trash"></i> ${t('row')}</button>
    <span class="toolbar-separator"></span>
    <button data-table-command="column-left" title="${t('columnLeft')}"><i class="codicon codicon-arrow-left"></i> ${t('columnShort')}</button>
    <button data-table-command="column-right" title="${t('columnRight')}"><i class="codicon codicon-arrow-right"></i> ${t('columnShort')}</button>
    <button data-table-command="column-delete" title="${t('deleteColumn')}"><i class="codicon codicon-trash"></i> ${t('columnShort')}</button>
    <span class="toolbar-separator"></span>
    <button data-table-command="align-left" title="${t('alignLeft')}"><i class="codicon codicon-list-unordered"></i></button>
    <button data-table-command="align-center" title="${t('alignCenter')}">↔</button>
    <button data-table-command="align-right" title="${t('alignRight')}"><i class="codicon codicon-list-ordered"></i></button>
  </div>
  <div class="markda-workspace"><div id="editor"></div><aside id="preview" aria-label="${t('renderedPreview')}"></aside></div>
  <div id="markda-welcome" class="markda-welcome" hidden><strong>${t('welcomeTitle')}</strong><span>${t('welcomeBody')}</span></div>
  <div id="quick-insert" class="markda-quick-insert" role="dialog" aria-label="${t('quickInsert')}" hidden>
    <input id="quick-insert-filter" type="text" autocomplete="off" placeholder="${t('quickInsertHint')}" aria-label="${t('quickInsertHint')}">
    <div id="quick-insert-items" role="listbox"></div>
  </div>
  <div id="selection-toolbar" class="markda-selection-toolbar" role="toolbar" aria-label="${t('editorControls')}" hidden>
    <button type="button" data-selection-command="toggleBold" title="${t('bold')}"><i class="codicon codicon-bold"></i></button>
    <button type="button" data-selection-command="toggleItalic" title="${t('italic')}"><i class="codicon codicon-italic"></i></button>
    <button type="button" data-selection-command="toggleStrikethrough" title="${t('strikethrough')}"><span><s>S</s></span></button>
    <button type="button" data-selection-command="toggleInlineCode" title="${t('inlineCode')}"><i class="codicon codicon-code"></i></button>
    <button type="button" data-selection-command="insertLink" title="${t('insertLink')}"><i class="codicon codicon-link"></i></button>
    <button type="button" data-selection-command="clearFormatting" title="${t('clearFormatting')}"><i class="codicon codicon-clear-all"></i></button>
  </div>
  <footer class="markda-status" aria-label="${t('statistics')}">
    <button id="document-mode-status" type="button"></button>
    <button id="document-section-status" type="button"></button>
    <span class="toolbar-spacer"></span>
    <button id="document-problems-status" type="button"></button>
    <span id="document-statistics-status"></span>
    <span id="document-sync-status" role="status" aria-live="polite">${t('syncSaved')}</span>
  </footer>
  <dialog id="table-dialog" aria-labelledby="table-dialog-title"><form method="dialog"><h2 id="table-dialog-title">${t('insertTable')}</h2><label>${t('columns')} <input id="table-columns" type="number" min="1" max="20" value="2"></label><label>${t('rows')} <input id="table-rows" type="number" min="1" max="100" value="2"></label><div><button value="cancel" formnovalidate>${t('cancel')}</button><button id="table-insert-confirm" value="default">${t('insert')}</button></div></form></dialog>
  <dialog id="link-dialog" aria-labelledby="link-dialog-title"><form method="dialog"><h2 id="link-dialog-title">${t('editLink')}</h2>
    <label>${t('linkText')} <input id="link-text" type="text"></label>
    <label>${t('linkUrl')} <input id="link-url" type="text" list="markda-link-targets"></label>
    <label>${t('linkTitle')} <input id="link-title" type="text"></label>
    <div><button value="cancel" formnovalidate>${t('cancel')}</button><button id="link-insert-confirm" value="default">${t('insert')}</button></div>
  </form></dialog>
  <datalist id="markda-code-languages">${['text','javascript','typescript','json','html','css','python','java','c','cpp','csharp','go','rust','ruby','php','sql','shell','powershell','yaml','toml','markdown'].map((language) => `<option value="${language}"></option>`).join('')}</datalist>
  <datalist id="markda-link-targets"></datalist>
</div>`;

const appRoot = document.querySelector<HTMLElement>('.markda-shell')!;
const preview = document.querySelector<HTMLElement>('#preview')!;

const tableDialog = document.querySelector<HTMLDialogElement>('#table-dialog')!;
const linkDialog = document.querySelector<HTMLDialogElement>('#link-dialog')!;
const editorToolbar = document.querySelector<HTMLElement>('#editor-toolbar')!;
const toolbarToggle = document.querySelector<HTMLButtonElement>('#toolbar-toggle')!;
function setToolbarExpanded(expanded: boolean): void {
  editorToolbar.classList.toggle('expanded', expanded);
  toolbarToggle.setAttribute('aria-expanded', String(expanded));
  toolbarToggle.setAttribute('aria-label', t(expanded ? 'hideControls' : 'showControls'));
  toolbarToggle.title = t(expanded ? 'hideControls' : 'showControls');
}
toolbarToggle.addEventListener('click', () => setToolbarExpanded(!editorToolbar.classList.contains('expanded')));
setToolbarExpanded(true);
editorToolbar.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !editorToolbar.classList.contains('expanded')) return;
  event.preventDefault();
  setToolbarExpanded(false);
  toolbarToggle.focus();
});
editorToolbar.addEventListener('focusin', () => {
  activeTableFrom = undefined;
  activeLiveTableCursor = undefined;
  appRoot.classList.remove('table-active');
});
document.querySelectorAll<HTMLButtonElement>('button[title]').forEach((button) => {
  if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title);
});
document.querySelectorAll<HTMLElement>('.toolbar-separator').forEach((separator) => separator.setAttribute('aria-hidden', 'true'));

const setBlockDecorations = StateEffect.define<DecorationSet>();
const setSoftBreakDecorations = StateEffect.define<DecorationSet>();
const setDiagnosticDecorations = StateEffect.define<DecorationSet>();

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
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const softBreakDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSoftBreakDecorations)) return effect.value;
    }
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const diagnosticDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnosticDecorations)) return effect.value;
    }
    return transaction.docChanged ? value.map(transaction.changes) : value;
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
      // The preconfigured Markdown language already includes the GFM grammar
      // Markda needs. `markdown()` additionally installs the complete HTML/CSS/
      // JavaScript language stack even though fenced blocks and HTML are edited
      // by Markda's own widgets. Keeping only the base language removes those
      // parsers from the startup bundle and its first-file compile path.
      markdownLanguage,
      syntaxHighlighting(createSyntaxHighlightStyle(), { fallback: true }),
      search({ top: true }),
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
      drawSelection(),
      highlightActiveLine(),
      createLivePreviewPlugin(),
      blockDecorationsField,
      createBlockSelectionHighlightPlugin(),
      softBreakDecorationsField,
      diagnosticDecorationsField,
      EditorView.updateListener.of(onEditorUpdate),
      Prec.high(EditorView.domEventHandlers({
        mousedown(event, editor) {
          if (event.button !== 0 || !(event.target instanceof Element)) return false;
          // Widget controls run their own pointer/focus lifecycle. Treating their
          // first mousedown as a document-caret move can rebuild the widget before
          // its click fires (notably for indented one-line display math).
          const interactive = event.target.closest(
            'button,input,textarea,select,[contenteditable="true"],[role="button"],[data-markda-interactive]',
          );
          if (interactive && interactive !== editor.contentDOM) return false;
          return beginLivePreviewPointer(event, editor);
        },
        click(event, editor) {
          const target = event.target;
          const link = target instanceof Element ? target.closest<HTMLElement>('.markda-link-text[data-href]') : null;
          if (link?.dataset.href && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            openDocumentLink(link.dataset.href);
            return true;
          }
          return false;
        },
      })),
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
document.querySelectorAll<HTMLButtonElement>('[data-selection-command]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => runCommand(button.dataset.selectionCommand as EditorCommand));
});
const paragraphStyle = document.querySelector<HTMLSelectElement>('#paragraph-style')!;
paragraphStyle.addEventListener('change', () => {
  runCommand('setHeading', Number(paragraphStyle.value));
  view.focus();
});
document.querySelectorAll<HTMLButtonElement>('[data-table-command]').forEach((button) => {
  button.addEventListener('click', () => runTableCommand(button.dataset.tableCommand ?? ''));
});
const themeToggleButton = document.querySelector<HTMLButtonElement>('#theme-toggle');
function updateThemeToggleLabel(): void {
  if (!themeToggleButton) return;
  const labels: Record<typeof settings.themeMode, string> = {
    auto: t('themeAuto'), light: t('themeLight'), dark: t('themeDark'),
  };
  themeToggleButton.querySelector('span')?.replaceChildren(document.createTextNode(`${t('theme')}: ${labels[settings.themeMode]}`));
  themeToggleButton.dataset.mode = settings.themeMode;
  themeToggleButton.setAttribute('aria-label', `${t('toggleTheme')}. ${t('themeCurrent', labels[settings.themeMode])}`);
  themeToggleButton.title = `${t('themeCurrent', labels[settings.themeMode])}. ${t('toggleTheme')}`;
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

tableDialog.querySelector('form')?.addEventListener('submit', (event) => {
  if ((event as SubmitEvent).submitter?.id === 'table-insert-confirm') insertTableFromDialog();
});
linkDialog.querySelector('form')?.addEventListener('submit', (event) => {
  if ((event as SubmitEvent).submitter?.id === 'link-insert-confirm') insertLinkFromDialog();
});
linkDialog.addEventListener('close', () => {
  linkDialogSelection = undefined;
  view.focus();
});
view.dom.addEventListener('paste', (event) => void handlePaste(event));
view.dom.addEventListener('drop', (event) => void receiveImageFiles(event.dataTransfer?.files, event));
view.contentDOM.addEventListener('contextmenu', (event) => {
  if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-markda-interactive]'))) return;
  event.preventDefault();
  openQuickInsert(event.clientX, event.clientY, true);
});
// CodeMirror creates a logical selection at position 0 even before the editor
// receives focus. Only expose source syntax when that selection owns the
// visible editing focus; otherwise the first line incorrectly looks active.
let livePreviewSelectionFocused = view.dom.ownerDocument.activeElement === view.contentDOM;
let editorFocusRefreshScheduled = false;
const refreshAfterEditorFocusChange = (event: FocusEvent) => {
  // Widget clicks often focus the editor and move its selection in the same
  // event turn. Make that selection active immediately, while leaving the
  // decoration refresh deferred so it cannot interrupt CodeMirror's update.
  if (event.type === 'focusin') livePreviewSelectionFocused = true;
  if (editorFocusRefreshScheduled) return;
  editorFocusRefreshScheduled = true;
  requestAnimationFrame(() => {
    editorFocusRefreshScheduled = false;
    livePreviewSelectionFocused = view.dom.ownerDocument.activeElement === view.contentDOM;
    if (view.dom.isConnected) view.dispatch({ effects: refreshInlinePreview.of(null) });
  });
};
// CodeMirror retains its logical selection when focus moves into a table/code
// widget or the toolbar. Refresh so that stale selection cannot keep Markdown
// source syntax exposed after the visible selection has ended.
view.contentDOM.addEventListener('focusin', refreshAfterEditorFocusChange);
view.contentDOM.addEventListener('focusout', refreshAfterEditorFocusChange);
preview.addEventListener('scroll', () => syncScroll(preview, view.scrollDOM));
view.scrollDOM.addEventListener('scroll', () => syncScroll(view.scrollDOM, preview));
preview.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).matches('a[data-href]')) {
    event.preventDefault();
    (event.target as HTMLElement).click();
  }
});
preview.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLElement>('a[data-href]') : undefined;
  if (!link?.dataset.href) return;
  event.preventDefault();
  openDocumentLink(link.dataset.href);
});
window.addEventListener('message', (event: MessageEvent<HostToEditorMessage>) => onHostMessage(event.data));
window.addEventListener('keydown', (event) => {
  if (event.key.toLocaleLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
  event.preventDefault();
  event.stopPropagation();
  synchronizeAndSave();
}, true);
window.addEventListener('beforeunload', () => {
  synchronizeBeforeSuspend();
  window.clearTimeout(sendTimer);
  window.clearTimeout(previewTimer);
  window.clearTimeout(derivedStateTimer);
});
window.addEventListener('pagehide', synchronizeBeforeSuspend);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') synchronizeBeforeSuspend(); });

function onHostMessage(message: HostToEditorMessage): void {
  switch (message.type) {
    case 'initialize':
      documentUri = message.uri;
      resourceBaseUri = message.resourceBaseUri;
      themeBaseUri = message.themeBaseUri;
      assetBaseUri = message.assetBaseUri ?? '';
      documentVersion = message.version;
      settings = message.settings;
      syncedText = message.text;
      inFlightTransaction = undefined;
      inFlightChanges = undefined;
      pendingChanges = undefined;
      pendingBaseText = undefined;
      pendingLineSeparator = undefined;
      setSyncState('saved');
      if (!replaceDocument(message.text)) scheduleDerivedStateUpdate();
      applySettings(true);
      return;
    case 'documentChanged':
      documentVersion = message.version;
      if (message.sourceTransactionId && message.sourceTransactionId === inFlightTransaction) {
        syncedText = applyTextChanges(syncedText, inFlightChanges ?? []);
        inFlightTransaction = undefined;
        inFlightChanges = undefined;
        flushEdit();
        if (!pendingChanges && !inFlightTransaction) setSyncState('saved');
      } else if ('text' in message) {
        if (inFlightTransaction || pendingChanges) setSyncState('conflict');
        syncedText = message.text;
        inFlightTransaction = undefined;
        inFlightChanges = undefined;
        pendingChanges = undefined;
        pendingBaseText = undefined;
        pendingLineSeparator = undefined;
        replaceDocument(message.text);
        window.setTimeout(() => setSyncState('saved'), 1200);
      }
      return;
    case 'configurationChanged':
      settings = message.settings;
      clientRenderer = undefined;
      applySettings(true);
      renderPreview();
      return;
    case 'diagnosticsChanged':
      applyDiagnostics(message.diagnostics);
      return;
    case 'command':
      runCommand(message.command, message.payload);
  }
}

function enhanceSearchPanel(panel: HTMLElement): void {
  if (panel.querySelector('.markda-replace-toggle')) return;
  const searchInput = panel.querySelector<HTMLInputElement>('input[name=search]');
  const replaceInput = panel.querySelector<HTMLInputElement>('input[name=replace]');
  if (!searchInput || !replaceInput) return;
  replaceInput.id ||= 'markda-search-replace';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'markda-replace-toggle';
  toggle.setAttribute('aria-controls', replaceInput.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', replaceInput.placeholder || 'Replace');
  toggle.title = replaceInput.placeholder || 'Replace';
  panel.classList.add('markda-replace-collapsed');
  toggle.addEventListener('click', () => {
    const expanded = panel.classList.toggle('markda-replace-collapsed') === false;
    toggle.setAttribute('aria-expanded', String(expanded));
  });
  panel.prepend(toggle);
}

function openMarkdaSearchPanel(editor: EditorView): boolean {
  const opened = openSearchPanel(editor);
  queueMicrotask(() => {
    const panel = editor.dom.querySelector<HTMLElement>('.cm-panel.cm-search');
    if (panel) enhanceSearchPanel(panel);
  });
  return opened;
}

function onEditorUpdate(update: ViewUpdate): void {
  if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalUpdate))) {
    if (pendingChanges) {
      pendingChanges = pendingChanges.compose(update.changes);
    } else {
      pendingChanges = update.changes;
      pendingBaseText = update.startState.doc.toString();
      pendingLineSeparator = lineSeparator;
    }
    scheduleEdit();
    setSyncState('pending');
  }
  if (update.docChanged) {
    cachedDocumentText = '';
    cachedTable = undefined;
    updateTableToolbar();
    scheduleDerivedStateUpdate();
    if (update.state.field(modeField).previewVisible) schedulePreviewRender();
    if (!emojiPromise && update.state.sliceDoc(Math.max(0, update.state.selection.main.head - 64), Math.min(update.state.doc.length, update.state.selection.main.head + 64)).includes(':')) {
      void loadFullEmoji();
    }
  }
  else if (update.selectionSet) {
    updateTableToolbar();
    const state = update.state.field(modeField);
    if (performance.now() >= suppressStateUntil) {
      vscode.postMessage({ type: 'state', sourceMode: state.sourceMode, focusMode: state.focusMode, typewriterMode: state.typewriterMode, cursor: update.state.selection.main.head });
    }
  }
  if (update.docChanged || update.selectionSet) updateDocumentStatus();
  if (update.docChanged || update.selectionSet || update.focusChanged) updateSelectionToolbar();
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
  if (inFlightTransaction || !pendingChanges || pendingBaseText === undefined || pendingLineSeparator === undefined) return;
  window.clearTimeout(sendTimer);
  sendTimer = undefined;
  const changes = changeSetToTextChanges(pendingChanges, pendingBaseText, pendingLineSeparator);
  pendingChanges = undefined;
  pendingBaseText = undefined;
  pendingLineSeparator = undefined;
  if (!changes.length) return;
  inFlightTransaction = `${documentVersion}:${crypto.randomUUID()}`;
  inFlightChanges = changes;
  setSyncState('saving');
  vscode.postMessage({
    type: 'edit', uri: documentUri, baseVersion: documentVersion, transactionId: inFlightTransaction,
    changes, selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
  });
}

function changeSetToTextChanges(
  changes: ChangeSet, baseText: string, separator: DocumentLineSeparator,
): TextChange[] {
  const result: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push({
      from: serializedDocumentOffset(baseText, fromA, separator),
      to: serializedDocumentOffset(baseText, toA, separator),
      insert: serializeDocumentText(inserted.toString(), separator),
    });
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
  if (!(active instanceof HTMLElement) || active === view.contentDOM) return;
  // Saving must not blur or rebuild a live widget: that changes its measured
  // height and makes the viewport visibly jump. Flush its pending DOM value
  // directly while preserving focus and selection.
  const flush = nestedEditableFlushers.get(active);
  if (flush) flush();
  else if (active.isContentEditable || active.matches('input, textarea, select')) active.blur();
}

function synchronizeBeforeSuspend(): void {
  flushActiveEditable();
  flushEdit();
  const expectedText = applyTextChanges(syncedText, inFlightChanges ?? []);
  const text = serializeDocumentText(view.state.doc.toString(), lineSeparator);
  if (text !== expectedText) {
    // The final snapshot subsumes the unsent tail. Clearing it prevents the tail
    // from being submitted a second time if this hidden webview becomes active.
    pendingChanges = undefined;
    pendingBaseText = undefined;
    pendingLineSeparator = undefined;
    vscode.postMessage({ type: 'finalSync', uri: documentUri, expectedText, text });
  }
}

function synchronizeAndSave(): void {
  flushActiveEditable();
  flushEdit();
  const expectedText = applyTextChanges(syncedText, inFlightChanges ?? []);
  const text = serializeDocumentText(view.state.doc.toString(), lineSeparator);
  // This snapshot includes any tail that could not be posted while another
  // transaction was in flight. The host processes messages serially, applies
  // that tail if its expected base still matches, and only then writes to disk.
  pendingChanges = undefined;
  pendingBaseText = undefined;
  pendingLineSeparator = undefined;
  suppressStateUntil = performance.now() + 250;
  vscode.postMessage({ type: 'save', uri: documentUri, expectedText, text });
}

function replaceDocument(text: string): boolean {
  const currentText = view.state.doc.toString();
  const normalizedText = normalizeDocumentText(text);
  lineSeparator = documentLineSeparator(text);
  if (currentText === normalizedText) return false;
  const position = Math.min(view.state.selection.main.head, normalizedText.length);
  const change = findMinimalChange(currentText, normalizedText);
  view.dispatch({
    changes: change,
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
      openMarkdaSearchPanel(view);
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
      void openLinkDialog();
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
      return;
    }
    case 'focusAnchor': {
      const fragment = payload && typeof payload === 'object' && 'fragment' in payload
        ? String(payload.fragment)
        : '';
      focusDocumentAnchor(fragment);
      return;
    }
  }
}

function applyDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
  currentDiagnostics = diagnostics;
  const ranges = diagnostics.flatMap((diagnostic) => {
    const from = Math.max(0, Math.min(diagnostic.from, view.state.doc.length));
    const to = Math.max(from, Math.min(diagnostic.to, view.state.doc.length));
    if (to <= from) return [];
    const title = `${diagnostic.source ? `${diagnostic.source}: ` : ''}${diagnostic.message}`;
    return [Decoration.mark({
      class: `markda-diagnostic markda-diagnostic-${diagnostic.severity}`,
      attributes: { title, 'aria-label': title },
    }).range(from, to)];
  });
  view.dispatch({ effects: setDiagnosticDecorations.of(Decoration.set(ranges, true)) });
  updateDocumentStatus();
}

function focusDocumentAnchor(fragment: string): void {
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* Keep the literal fragment. */ }
  const heading = headingAnchors(view.state.doc.toString()).find((candidate) => candidate.slug === decoded);
  if (!heading) return;
  const position = Math.max(0, Math.min(heading.from, view.state.doc.length));
  view.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position, { y: 'center' }) });
  view.focus();
}

function openDocumentLink(href: string): void {
  if (href.startsWith('#')) focusDocumentAnchor(href.slice(1));
  else vscode.postMessage({ type: 'openLink', href });
}

function updateMode(change: Partial<ViewState>): void {
  const next = { ...view.state.field(modeField), ...change };
  view.dispatch({ effects: setMode.of(change) });
  applyViewState(next);
  vscode.setState(next);
  vscode.postMessage({ type: 'state', sourceMode: next.sourceMode, focusMode: next.focusMode, typewriterMode: next.typewriterMode });
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
  updateDocumentStatus();
}

function applySettings(refreshDecorations = false): void {
  // A contentWidth of 0 (or unset) means "fill the window" — the editor area
  // grows with the window instead of being capped at a fixed measure.
  const contentWidth = settings.contentWidth && settings.contentWidth > 0 ? `${settings.contentWidth}px` : 'none';
  document.documentElement.style.setProperty('--markda-content-width', contentWidth);
  // When capped, center the content; when filling the window, use a fixed gutter.
  const paddingX = '24px';
  document.documentElement.style.setProperty('--markda-padding-x', paddingX);
  document.documentElement.style.setProperty('--markda-font-size', `${settings.fontSize ?? 16}px`);
  document.documentElement.style.setProperty('--markda-line-height', String(settings.lineHeight ?? 1.6));
  document.documentElement.style.setProperty('--markda-paragraph-spacing', `${settings.paragraphSpacing ?? 0}em`);
  if (settings.fontFamily?.trim()) document.documentElement.style.setProperty('--markda-font-body', settings.fontFamily);
  const dark = usesDarkColors();
  const colorMode = dark ? 'dark' : 'light';
  const previousColorMode = document.documentElement.dataset.markdaColorMode;
  const themeName = (dark ? settings.theme.dark : settings.theme.light).replace(/[^a-zA-Z0-9._-]/gu, '');
  document.body.dataset.markdaTheme = themeName;
  document.documentElement.dataset.markdaColorMode = colorMode;
  document.documentElement.style.colorScheme = colorMode;
  let themeLink = document.querySelector<HTMLLinkElement>('#markda-user-theme');
  if (!themeLink) {
    themeLink = document.createElement('link');
    themeLink.id = 'markda-user-theme';
    themeLink.rel = 'stylesheet';
    document.head.append(themeLink);
  }
  themeLink.href = themeBaseUri && themeName ? `${themeBaseUri}${encodeURIComponent(themeName)}.css` : '';
  const colorModeChanged = previousColorMode !== colorMode;
  if (colorModeChanged) colorThemeRevision++;
  // Color-only changes are handled by the shared CSS palette. Rebuild live
  // decorations only when settings that affect their structure have changed.
  if (refreshDecorations) view.dispatch({ effects: refreshLivePreview.of(null) });
  if (colorModeChanged) {
    queueMicrotask(() => {
      document.querySelectorAll<HTMLElement>('[data-markda-renderer="mermaid"]').forEach((element) => {
        void renderLiveMermaid(element, element.dataset.markdaSource ?? '');
      });
    });
    renderPreview();
  }
}

new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      applySettings();
    }
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

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
  const documentText = view.state.doc.toString();
  const changes: { from: number; to: number; insert: string }[] = [];
  let from = 0;
  while ((from = documentText.indexOf(payload.source, from)) >= 0) {
    changes.push({ from, to: from + payload.source.length, insert: payload.newSource });
    from += payload.source.length;
  }
  if (changes.length) view.dispatch({ changes });
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
  const header = `| ${Array.from({ length: columns }, (_value, index) => `${t('columnShort')} ${index + 1}`).join(' | ')} |`;
  const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
  const row = `| ${Array.from({ length: columns }, () => '').join(' | ')} |`;
  insertAtSelection([header, separator, ...Array.from({ length: rows }, () => row)].join('\n'));
}

async function openLinkDialog(): Promise<void> {
  const selection = view.state.selection.main;
  linkDialogSelection = { from: selection.from, to: selection.to };
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const existing = selected.match(/^\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)$/u);
  const textInput = document.querySelector<HTMLInputElement>('#link-text')!;
  const urlInput = document.querySelector<HTMLInputElement>('#link-url')!;
  const titleInput = document.querySelector<HTMLInputElement>('#link-title')!;
  const targets = document.querySelector<HTMLDataListElement>('#markda-link-targets')!;
  targets.replaceChildren(...headingAnchors(view.state.doc.toString()).map((heading) => {
    const option = document.createElement('option');
    option.value = `#${heading.slug}`;
    option.label = heading.text;
    return option;
  }));
  textInput.value = existing?.[1] ?? selected;
  urlInput.value = existing?.[2] ?? '';
  titleInput.value = existing?.[3] ?? '';
  if (!urlInput.value) {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (/^(?:https?:\/\/|\.{0,2}\/|#)/iu.test(clipboard.trim())) urlInput.value = clipboard.trim();
    } catch { /* Clipboard permission is optional inside the webview. */ }
  }
  linkDialog.showModal();
  queueMicrotask(() => (textInput.value ? urlInput : textInput).focus());
}

function insertLinkFromDialog(): void {
  if (!linkDialogSelection) return;
  const text = document.querySelector<HTMLInputElement>('#link-text')!.value || document.querySelector<HTMLInputElement>('#link-url')!.value;
  const url = document.querySelector<HTMLInputElement>('#link-url')!.value.trim();
  const title = document.querySelector<HTMLInputElement>('#link-title')!.value.trim();
  if (!url) return;
  const escapedText = text.replace(/[[\]]/gu, '\\$&');
  const escapedUrl = url.replace(/[()]/gu, '\\$&');
  const escapedTitle = title.replace(/"/gu, '\\"');
  const insert = `[${escapedText}](${escapedUrl}${escapedTitle ? ` "${escapedTitle}"` : ''})`;
  view.dispatch({
    changes: { from: linkDialogSelection.from, to: linkDialogSelection.to, insert },
    selection: EditorSelection.range(linkDialogSelection.from + 1, linkDialogSelection.from + 1 + escapedText.length),
  });
}

interface QuickInsertItem {
  readonly label: string;
  readonly icon: string;
  readonly keywords: string;
  readonly action: () => void;
}

const quickInsertItems: readonly QuickInsertItem[] = [
  ...Array.from({ length: 6 }, (_value, index): QuickInsertItem => ({
    label: t('heading', index + 1), icon: 'symbol-key', keywords: `h${index + 1} heading`,
    action: () => setHeading(view, index + 1),
  })),
  { label: t('bulletedList'), icon: 'list-unordered', keywords: 'list bullet', action: () => toggleLinePrefix('- ') },
  { label: t('orderedList'), icon: 'list-ordered', keywords: 'list numbered', action: toggleOrderedList },
  { label: t('taskList'), icon: 'checklist', keywords: 'todo checkbox', action: () => toggleLinePrefix('- [ ] ') },
  { label: t('blockquote'), icon: 'quote', keywords: 'quote', action: toggleBlockquote },
  { label: t('codeBlock'), icon: 'symbol-method', keywords: 'code fence', action: () => { wrapCodeBlock(view); } },
  { label: t('insertTable'), icon: 'table', keywords: 'table', action: () => tableDialog.showModal() },
  { label: t('insertImages'), icon: 'file-media', keywords: 'image picture', action: () => vscode.postMessage({ type: 'requestImage', selection: currentSelection() }) },
  { label: t('insertMath'), icon: 'symbol-operator', keywords: 'math equation', action: () => insertAtSelection('$$\n\\displaystyle x = 0\n$$') },
  { label: t('horizontalRule'), icon: 'remove', keywords: 'rule divider', action: () => insertAtSelection('---') },
  { label: t('tableOfContents'), icon: 'list-tree', keywords: 'toc contents', action: () => insertAtSelection('[toc]') },
  { label: t('frontMatter'), icon: 'settings', keywords: 'yaml metadata', action: () => insertAtSelection('---\ntitle: \n---\n\n') },
  { label: t('callout'), icon: 'info', keywords: 'alert note callout', action: () => insertAtSelection('> [!NOTE]\n> ') },
  { label: t('footnote'), icon: 'references', keywords: 'footnote reference', action: () => insertAtSelection('[^1]\n\n[^1]: ') },
];

const quickInsert = document.querySelector<HTMLElement>('#quick-insert')!;
const quickInsertFilter = document.querySelector<HTMLInputElement>('#quick-insert-filter')!;
const quickInsertList = document.querySelector<HTMLElement>('#quick-insert-items')!;
function renderQuickInsertItems(filter = '', contextual = false): void {
  const normalized = filter.trim().toLocaleLowerCase();
  const items = (contextual
    ? [
        { label: t('bold'), icon: 'bold', keywords: 'format strong', action: () => wrapSelection(view, '**', '**') },
        { label: t('italic'), icon: 'italic', keywords: 'format emphasis', action: () => wrapSelection(view, '*', '*') },
        { label: t('insertLink'), icon: 'link', keywords: 'url link', action: () => { void openLinkDialog(); } },
        { label: t('clearFormatting'), icon: 'clear-all', keywords: 'plain reset', action: () => { clearFormatting(view); } },
        { label: t('moveBlockUp'), icon: 'arrow-up', keywords: 'block move', action: () => { moveCurrentBlock(view, -1); } },
        { label: t('moveBlockDown'), icon: 'arrow-down', keywords: 'block move', action: () => { moveCurrentBlock(view, 1); } },
        { label: t('duplicateBlock'), icon: 'files', keywords: 'block duplicate copy', action: () => { duplicateCurrentBlock(view); } },
        ...quickInsertItems,
      ]
    : quickInsertItems).filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(normalized));
  quickInsertList.replaceChildren();
  for (const [index, item] of items.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.dataset.index = String(index);
    button.innerHTML = `<i class="codicon codicon-${item.icon}" aria-hidden="true"></i><span></span>`;
    button.querySelector('span')!.textContent = item.label;
    button.addEventListener('click', () => {
      closeQuickInsert();
      item.action();
      view.focus();
    });
    quickInsertList.append(button);
  }
  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'markda-quick-insert-empty';
    empty.textContent = t('noCommands');
    quickInsertList.append(empty);
  }
}

function openQuickInsert(x?: number, y?: number, contextual = false): void {
  quickInsert.hidden = false;
  quickInsert.dataset.contextual = String(contextual);
  quickInsert.style.left = `${Math.max(8, Math.min(x ?? 24, window.innerWidth - 310))}px`;
  quickInsert.style.top = `${Math.max(8, Math.min(y ?? 64, window.innerHeight - 390))}px`;
  quickInsertFilter.value = '';
  renderQuickInsertItems('', contextual);
  quickInsertFilter.focus();
}

function closeQuickInsert(): void {
  quickInsert.hidden = true;
  quickInsertFilter.value = '';
}

quickInsertFilter.addEventListener('input', () => renderQuickInsertItems(
  quickInsertFilter.value, quickInsert.dataset.contextual === 'true',
));
quickInsert.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeQuickInsert();
    view.focus();
    return;
  }
  const options = [...quickInsertList.querySelectorAll<HTMLButtonElement>('button')];
  const active = document.activeElement;
  const index = options.indexOf(active as HTMLButtonElement);
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    (options[index + 1] ?? options[0])?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    (options[index - 1] ?? options.at(-1))?.focus();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!quickInsert.hidden && event.target instanceof Node && !quickInsert.contains(event.target)) closeQuickInsert();
});

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Math.round(value) : minimum));
}

function activateOnKeyboard(event: Event, action: () => void): void {
  if (!(event instanceof KeyboardEvent)
    || (event.key !== 'Enter' && event.key !== ' ')
    || event.repeat) return;
  event.preventDefault();
  action();
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
  if (performance.now() >= suppressStateUntil) {
    vscode.postMessage({ type: 'state', sourceMode: mode.sourceMode, focusMode: mode.focusMode, typewriterMode: mode.typewriterMode, cursor: view.state.selection.main.head });
  }
  updateTableToolbar(source);
  updateDocumentStatus(stat);
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

function setSyncState(state: 'saved' | 'saving' | 'pending' | 'conflict'): void {
  const element = document.querySelector<HTMLElement>('#document-sync-status');
  if (!element) return;
  element.dataset.state = state;
  element.textContent = t(state === 'saved' ? 'syncSaved'
    : state === 'saving' ? 'syncSaving'
      : state === 'pending' ? 'syncPending' : 'syncConflict');
}

function updateSelectionToolbar(): void {
  const toolbar = document.querySelector<HTMLElement>('#selection-toolbar');
  if (!toolbar || !view.dom.isConnected) return;
  const selection = view.state.selection.main;
  if (selection.empty || view.state.field(modeField).sourceMode || !view.hasFocus) {
    toolbar.hidden = true;
    return;
  }
  const start = view.coordsAtPos(selection.from);
  const end = view.coordsAtPos(selection.to);
  if (!start || !end) {
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;
  toolbar.style.left = `${Math.max(8, Math.min((start.left + end.right) / 2 - 100, window.innerWidth - 220))}px`;
  toolbar.style.top = `${Math.max(8, Math.min(start.top - 38, window.innerHeight - 44))}px`;
}

function updateDocumentStatus(statistics = calculateStatistics()): void {
  if (!view.dom.isConnected) return;
  const mode = view.state.field(modeField);
  const modeButton = document.querySelector<HTMLButtonElement>('#document-mode-status');
  if (!modeButton) return;
  modeButton.textContent = mode.sourceMode ? t('sourceShort') : t('liveShort');
  modeButton.title = t('toggleSourceMode');
  const statisticsElement = document.querySelector<HTMLElement>('#document-statistics-status');
  if (!statisticsElement) return;
  statisticsElement.textContent = `${t('wordsShort', statistics.words)} · ${t('charactersShort', statistics.characters)}`;
  const headings = headingAnchors(view.state.doc.toString());
  const cursor = view.state.selection.main.head;
  const active = [...headings].reverse().find((heading) => heading.from <= cursor);
  const sectionButton = document.querySelector<HTMLButtonElement>('#document-section-status');
  if (!sectionButton) return;
  sectionButton.textContent = active ? `H${active.level} ${active.text}` : '';
  sectionButton.dataset.from = active ? String(active.from) : '';
  sectionButton.hidden = !active;
  const problemsButton = document.querySelector<HTMLButtonElement>('#document-problems-status');
  if (!problemsButton) return;
  problemsButton.textContent = currentDiagnostics.length ? `${t('diagnostics')}: ${currentDiagnostics.length}` : '';
  problemsButton.hidden = !currentDiagnostics.length;
  const welcome = document.querySelector<HTMLElement>('#markda-welcome');
  if (!welcome) return;
  welcome.hidden = view.state.doc.length !== 0;
  const line = view.state.doc.lineAt(cursor);
  const level = line.text.match(/^#{1,6}(?=\s)/u)?.[0].length ?? 0;
  if (paragraphStyle.value !== String(level)) paragraphStyle.value = String(level);
}

document.querySelector<HTMLButtonElement>('#document-mode-status')!.addEventListener('click', () => runCommand('toggleSourceMode'));
document.querySelector<HTMLButtonElement>('#document-section-status')!.addEventListener('click', (event) => {
  const from = Number((event.currentTarget as HTMLButtonElement).dataset.from);
  if (!Number.isInteger(from)) return;
  view.dispatch({ selection: EditorSelection.cursor(from), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  view.focus();
});
document.querySelector<HTMLButtonElement>('#document-problems-status')!.addEventListener('click', () => {
  const cursor = view.state.selection.main.head;
  const diagnostic = currentDiagnostics.find((item) => cursor >= item.from && cursor <= item.to) ?? currentDiagnostics[0];
  if (!diagnostic) return;
  view.dispatch({ selection: EditorSelection.range(diagnostic.from, diagnostic.to), effects: EditorView.scrollIntoView(diagnostic.from, { y: 'center' }) });
  vscode.postMessage({ type: 'requestCodeActions', from: diagnostic.from, to: diagnostic.to });
});
document.querySelector<HTMLElement>('#markda-welcome')!.addEventListener('click', () => view.focus());

function extractHeadings(text: string): Heading[] {
  return analyzeDocument(text).headings;
}

function currentSelection(): { anchor: number; head: number } {
  return { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
}

function applyRelativeTextEdit(editor: EditorView, offset: number, edit: TextEdit | undefined): boolean {
  if (!edit) return false;
  editor.dispatch({
    changes: { from: offset + edit.from, to: offset + edit.to, insert: edit.insert },
    selection: EditorSelection.cursor(offset + edit.cursor),
  });
  return true;
}

function createMarkdownPairing() { return EditorView.inputHandler.of((editor, from, to, text) => {
  if (!settings.autoPairMarkdown) return false;
  const selectionLength = to - from;
  // Pairing only depends on the selected text and the next character. Avoid
  // materializing the complete document on every ordinary text input.
  const context = editor.state.sliceDoc(from, Math.min(editor.state.doc.length, to + 1));
  return applyRelativeTextEdit(
    editor,
    from,
    markdownPairEdit(context, 0, selectionLength, text, settings.markdown.math),
  );
}); }

function deleteEmptyMarkdownPair(editor: EditorView): boolean {
  if (!settings.autoPairMarkdown) return false;
  const selection = editor.state.selection.main;
  if (!selection.empty || selection.head <= 0 || selection.head >= editor.state.doc.length) return false;
  const offset = selection.head - 1;
  const context = editor.state.sliceDoc(offset, selection.head + 1);
  return applyRelativeTextEdit(editor, offset, markdownPairDeletion(context, 1, settings.markdown.math));
}

function skipAutomaticCloser(editor: EditorView, character: string): boolean {
  if (!settings.autoPairMarkdown) return false;
  const selection = editor.state.selection.main;
  if (!selection.empty || editor.state.sliceDoc(selection.head, selection.head + 1) !== character) return false;
  editor.dispatch({ selection: EditorSelection.cursor(selection.head + 1) });
  return true;
}

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
    { key: 'Mod-f', run: openMarkdaSearchPanel },
    { key: 'Enter', run: (editor: EditorView) => insertLiveLineBreak(editor, false) },
    { key: 'Shift-Enter', run: (editor: EditorView) => insertLiveLineBreak(editor, true) },
    { key: 'Backspace', run: deleteEmptyMarkdownPair },
    // Handle asymmetric closers before Chromium maps the caret through hidden
    // live-preview delimiters. Waiting for beforeinput can otherwise turn `[]`
    // into `[]]` even though the logical CodeMirror selection is between them.
    { key: ']', run: (editor: EditorView) => skipAutomaticCloser(editor, ']') },
    { key: ')', run: (editor: EditorView) => skipAutomaticCloser(editor, ')') },
    { key: '}', run: (editor: EditorView) => skipAutomaticCloser(editor, '}') },
    { key: 'ArrowUp', run: (editor: EditorView) => moveCursorVertically(editor, -1, false) },
    { key: 'ArrowDown', run: (editor: EditorView) => moveCursorVertically(editor, 1, false) },
    { key: 'Shift-ArrowUp', run: (editor: EditorView) => moveCursorVertically(editor, -1, true) },
    { key: 'Shift-ArrowDown', run: (editor: EditorView) => moveCursorVertically(editor, 1, true) },
    { key: 'Alt-ArrowUp', run: (editor: EditorView) => moveCurrentBlock(editor, -1) },
    { key: 'Alt-ArrowDown', run: (editor: EditorView) => moveCurrentBlock(editor, 1) },
    { key: 'Mod-Shift-d', run: duplicateCurrentBlock },
    { key: 'Tab', run: (editor: EditorView) => navigateTableCell(editor, false) },
    { key: 'Shift-Tab', run: (editor: EditorView) => navigateTableCell(editor, true) },
    { key: 'Mod-b', run: (editor: EditorView) => wrapSelection(editor, '**', '**') },
    { key: 'Mod-i', run: (editor: EditorView) => wrapSelection(editor, '*', '*') },
    { key: 'Mod-k', run: () => { void openLinkDialog(); return true; } },
    { key: '/', run: (editor: EditorView) => {
      const selection = editor.state.selection.main;
      if (!selection.empty || editor.state.field(modeField).sourceMode) return false;
      const line = editor.state.doc.lineAt(selection.head);
      if (editor.state.sliceDoc(line.from, selection.head).trim()) return false;
      const coords = editor.coordsAtPos(selection.head);
      openQuickInsert(coords?.left, coords?.bottom);
      return true;
    } },
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

function currentBlockLines(editor: EditorView): { start: number; end: number } {
  const doc = editor.state.doc;
  const cursorLine = doc.lineAt(editor.state.selection.main.head).number;
  let start = cursorLine;
  let end = cursorLine;
  while (start > 1 && doc.line(start - 1).text.trim()) start--;
  while (end < doc.lines && doc.line(end + 1).text.trim()) end++;
  return { start, end };
}

function duplicateCurrentBlock(editor: EditorView): boolean {
  const { start, end } = currentBlockLines(editor);
  const from = editor.state.doc.line(start).from;
  const to = editor.state.doc.line(end).to;
  const source = editor.state.sliceDoc(from, to);
  const separator = editor.state.sliceDoc(to, Math.min(editor.state.doc.length, to + 2)).startsWith('\r\n') ? '\r\n' : '\n';
  editor.dispatch({
    changes: { from: to, insert: `${separator}${source}` },
    selection: EditorSelection.range(to + separator.length, to + separator.length + source.length),
  });
  return true;
}

function moveCurrentBlock(editor: EditorView, direction: -1 | 1): boolean {
  const doc = editor.state.doc;
  const current = currentBlockLines(editor);
  if ((direction < 0 && current.start <= 1) || (direction > 0 && current.end >= doc.lines)) return false;
  if (direction < 0) {
    let previousEnd = current.start - 1;
    while (previousEnd > 1 && !doc.line(previousEnd).text.trim()) previousEnd--;
    let previousStart = previousEnd;
    while (previousStart > 1 && doc.line(previousStart - 1).text.trim()) previousStart--;
    const from = doc.line(previousStart).from;
    const previousTo = doc.line(previousEnd).to;
    const currentFrom = doc.line(current.start).from;
    const currentTo = doc.line(current.end).to;
    const previousText = editor.state.sliceDoc(from, previousTo);
    const between = editor.state.sliceDoc(previousTo, currentFrom);
    const currentText = editor.state.sliceDoc(currentFrom, currentTo);
    editor.dispatch({
      changes: { from, to: currentTo, insert: `${currentText}${between}${previousText}` },
      selection: EditorSelection.range(from, from + currentText.length),
    });
    return true;
  }
  let nextStart = current.end + 1;
  while (nextStart < doc.lines && !doc.line(nextStart).text.trim()) nextStart++;
  let nextEnd = nextStart;
  while (nextEnd < doc.lines && doc.line(nextEnd + 1).text.trim()) nextEnd++;
  const currentFrom = doc.line(current.start).from;
  const currentTo = doc.line(current.end).to;
  const nextFrom = doc.line(nextStart).from;
  const nextTo = doc.line(nextEnd).to;
  const currentText = editor.state.sliceDoc(currentFrom, currentTo);
  const between = editor.state.sliceDoc(currentTo, nextFrom);
  const nextText = editor.state.sliceDoc(nextFrom, nextTo);
  const selectionFrom = currentFrom + nextText.length + between.length;
  editor.dispatch({
    changes: { from: currentFrom, to: nextTo, insert: `${nextText}${between}${currentText}` },
    selection: EditorSelection.range(selectionFrom, selectionFrom + currentText.length),
  });
  return true;
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
  const activeElement = document.activeElement;
  const tableToolbar = document.querySelector<HTMLElement>('#table-toolbar');
  if (activeElement && activeElement !== document.body
    && !view.dom.contains(activeElement) && !tableToolbar?.contains(activeElement)) {
    appRoot.classList.remove('table-active');
    return;
  }
  if (activeLiveTableCursor) {
    if (!source) source = view.state.doc.toString();
    const table = findMarkdownTable(source, activeLiveTableCursor.from,
      view.state.doc.lineAt(activeLiveTableCursor.from).number - 1);
    if (table) {
      appRoot.classList.add('table-active');
      updateTableToolbarButtons(table, activeLiveTableCursor.row);
      return;
    }
    activeLiveTableCursor = undefined;
  }
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
  if (table) updateTableToolbarButtons(table, cursor?.row ?? -1);
}

function updateTableToolbarButtons(table: MarkdownTable, row: number): void {
  document.querySelector<HTMLButtonElement>('[data-table-command="row-delete"]')!.disabled = row < 0;
  document.querySelector<HTMLButtonElement>('[data-table-command="column-delete"]')!.disabled = table.header.length <= 1;
}

function runTableCommand(command: string): void {
  const source = view.state.doc.toString();
  const liveCursor = activeLiveTableCursor;
  const tableOffset = liveCursor?.from ?? view.state.selection.main.head;
  const table = findMarkdownTable(source, tableOffset, view.state.doc.lineAt(tableOffset).number - 1);
  if (!table) return;
  const cursor = liveCursor
    ? { row: liveCursor.row, column: liveCursor.column }
    : tableCursor(source, table, view.state.selection.main.head);
  let updated: MarkdownTable = table;
  let focusRow = cursor.row;
  let focusColumn = cursor.column;
  switch (command) {
    case 'row-before':
      focusRow = Math.max(0, cursor.row);
      updated = addTableRow(table, focusRow);
      break;
    case 'row-after':
      focusRow = cursor.row < 0 ? 0 : cursor.row + 1;
      updated = addTableRow(table, focusRow);
      break;
    case 'row-delete':
      updated = deleteTableRow(table, cursor.row);
      focusRow = updated.rows.length === 0 ? -1 : Math.min(cursor.row, updated.rows.length - 1);
      break;
    case 'column-left':
      focusColumn = cursor.column;
      updated = addTableColumn(table, focusColumn);
      break;
    case 'column-right':
      focusColumn = cursor.column + 1;
      updated = addTableColumn(table, focusColumn);
      break;
    case 'column-delete':
      updated = deleteTableColumn(table, cursor.column);
      focusColumn = Math.min(cursor.column, updated.header.length - 1);
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
  if (liveCursor) replaceLiveTable(source, table, updated, focusRow, Math.min(focusColumn, updated.header.length - 1));
  else replaceTable(source, table, updated, cursor.row, Math.min(cursor.column, updated.header.length - 1));
}

function replaceLiveTable(
  source: string, original: MarkdownTable, updated: MarkdownTable, row: number, column: number,
): void {
  const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  activeTableFrom = undefined;
  activeLiveTableCursor = { from: original.from, row, column };
  view.dispatch({ changes: { from: original.from, to: original.to, insert: serializeMarkdownTable(updated, eol) } });
  requestAnimationFrame(() => {
    const wrapper = Array.from(document.querySelectorAll<HTMLElement>('.markda-live-table-wrap'))
      .find((element) => element.dataset.tableFrom === String(original.from));
    const cell = Array.from(wrapper?.querySelectorAll<HTMLElement>('th,td') ?? [])
      .find((element) => element.dataset.tableRow === String(row) && element.dataset.tableColumn === String(column));
    cell?.focus();
  });
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
  const activeLine = editor.state.doc.lineAt(editor.state.selection.main.head);
  const activeIsSetextMarker = /^[ \t]{0,3}(?:=+|-+)[ \t]*$/u.test(activeLine.text) && activeLine.number > 1;
  const line = activeIsSetextMarker ? editor.state.doc.line(activeLine.number - 1) : activeLine;
  const nextLine = line.number < editor.state.doc.lines ? editor.state.doc.line(line.number + 1) : undefined;
  const setextMarker = nextLine && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/u.test(nextLine.text) && line.text.trim()
    ? nextLine
    : undefined;
  const existing = line.text.match(/^#{1,6}[ \t]+/u)?.[0] ?? '';
  const replacement = level === 0 ? '' : `${'#'.repeat(level)} `;
  editor.dispatch({
    changes: [
      { from: line.from, to: line.from + existing.length, insert: replacement },
      ...(setextMarker ? [{ from: line.to, to: setextMarker.to, insert: '' }] : []),
    ],
    selection: EditorSelection.cursor(line.from + replacement.length),
  });
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
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'button', 'textarea', 'select', 'option', 'base', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'srcdoc', 'autofocus'],
  });
  removeUnsafeHtmlNodes(preview, true);
  secureRenderedHtml(preview);
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
    element.title = t('editSection');
    const focus = () => { view.dispatch({ selection: EditorSelection.cursor(heading.from), effects: EditorView.scrollIntoView(heading.from, { y: 'center' }) }); view.focus(); };
    element.addEventListener('click', focus);
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `${element.textContent ?? ''}. ${t('editHere')}`);
    element.addEventListener('keydown', (event) => activateOnKeyboard(event, focus));
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
    blocked.textContent = t('remoteImageBlocked', image.alt || source);
    blocked.title = source;
    image.replaceWith(blocked);
    return;
  }
  if (/^(?:data:|vscode-webview:|#)/iu.test(source)) return;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(source)) {
    image.replaceWith(document.createTextNode(image.alt || source));
    return;
  }
  try {
    image.src = new URL(source, resourceBaseUri).toString();
  } catch {
    image.replaceWith(document.createTextNode(image.alt || source));
  }
}

function sanitizeHtmlFragment(source: string): string {
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'style', 'form', 'input', 'button', 'textarea', 'select', 'option',
      'iframe', 'object', 'embed', 'base', 'link', 'meta',
    ],
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'srcdoc', 'autofocus'],
  });
}

function removeUnsafeHtmlNodes(container: ParentNode, preserveTaskInputs = false): void {
  container.querySelectorAll(
    'script,style,form,input,button,textarea,select,option,iframe,object,embed,base,link,meta',
  ).forEach((element) => {
    if (preserveTaskInputs && element.matches('input.task-list-item-checkbox')) return;
    element.remove();
  });
  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/iu.test(attribute.name)
        || ['style', 'srcset', 'formaction', 'srcdoc', 'autofocus'].includes(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

function sanitizeEditableHtmlSource(source: string): string {
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtmlFragment(source);
  removeUnsafeHtmlNodes(container);
  return container.innerHTML.replace(/\r\n?/gu, '\n');
}

function secureRenderedHtml(container: ParentNode): void {
  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (/^(?:javascript|vbscript|data):/iu.test(href.trim())) {
      link.removeAttribute('href');
      link.removeAttribute('data-href');
      return;
    }
    link.dataset.href = href;
    link.removeAttribute('href');
    link.tabIndex = 0;
  });
  container.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => secureImage(image));
  container.querySelectorAll<HTMLInputElement>('input:not(.task-list-item-checkbox)').forEach((input) => {
    input.disabled = true;
    input.removeAttribute('name');
  });
}

function createClientRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({ breaks: settings.markdown.breaks, html: settings.markdown.html, linkify: true });
  renderer.use(footnote).use(mark).use(sub).use(sup).use(taskLists, { enabled: true, label: true }).use(emojiPlugin);
  installDocumentFeatures(renderer);
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
  return katexPromise ??= Promise.all([
    import('./katexLoader.js'),
    assetBaseUri
      ? loadStylesheet(`${assetBaseUri}katex.css`, 'markda-katex-styles')
      : Promise.resolve(),
  ]).then(([module]) => {
    katexInstance = module.api;
    return module.api;
  });
}

function loadFullEmoji(): Promise<void> {
  return emojiPromise ??= import('./emojiLoader.js').then((module) => {
    emojiPlugin = module.api.plugin;
    emojiNames = module.api.data;
    clientRenderer = undefined;
    view.dispatch({ effects: refreshLivePreview.of(null) });
    if (view.state.field(modeField).previewVisible) renderPreview();
  });
}

function loadStylesheet(href: string, id: string): Promise<void> {
  if (id === 'markda-katex-styles' && katexStylesPromise) return katexStylesPromise;
  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLLinkElement>(`#${id}`);
    if (existing?.sheet) {
      resolve();
      return;
    }
    const link = existing ?? document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => reject(new Error(`Unable to load stylesheet: ${href}`)), { once: true });
    link.href = href;
    if (!existing) document.head.append(link);
  });
  if (id === 'markda-katex-styles') katexStylesPromise = promise;
  return promise;
}

async function renderKatexInto(element: HTMLElement, source: string, displayMode: boolean): Promise<void> {
  try {
    const katex = await loadKatex();
    if (!element.isConnected) return;
    katex.render(prepareLiveMath(source, displayMode), element, { displayMode, throwOnError: false, strict: 'warn', trust: false });
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
      const result = await mermaid.render(`markda-diagram-${index}-${crypto.randomUUID()}`, block.textContent ?? '');
      if (renderVersion !== previewRenderVersion) return;
      const container = document.createElement('div');
      container.className = 'markda-diagram';
      container.innerHTML = validateMermaidSvg(result.svg);
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

function markdaColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function renderInlinePreview(element: HTMLElement, source: string): void {
  const renderer = clientRenderer ??= createClientRenderer();
  element.innerHTML = DOMPurify.sanitize(renderer.renderInline(source), { USE_PROFILES: { html: true } });
}

function initializeMermaid(mermaid: typeof import('mermaid')['default']): void {
  const dark = usesDarkColors();
  const fg = markdaColor('--markda-fg', dark ? '#d4d4d4' : '#1a1a1a');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    htmlLabels: false,
    themeVariables: {
      primaryTextColor: fg,
      lineColor: fg,
      textColor: fg,
      primaryColor: markdaColor('--markda-surface-secondary', dark ? '#2d2d30' : '#eef2f6'),
      primaryBorderColor: markdaColor('--markda-border', dark ? '#5a5a5a' : '#afb8c1'),
      mainBkg: markdaColor('--markda-surface-secondary', dark ? '#2d2d30' : '#eef2f6'),
      nodeBorder: markdaColor('--markda-border', dark ? '#5a5a5a' : '#afb8c1'),
    },
  });
}

function validateMermaidSvg(svg: string): string {
  // securityLevel=strict already sanitizes Mermaid's output, and htmlLabels=false
  // keeps labels in native SVG text nodes. A second DOMPurify pass removed those
  // valid labels, so verify the strict renderer's security postconditions instead.
  if (!/^\s*<svg(?:\s|>)/iu.test(svg)
    || /<\s*(?:script|iframe|object|embed)(?:\s|>)/iu.test(svg)
    || /\s+on[a-z][\w:-]*\s*=/iu.test(svg)
    || /\s+(?:href|xlink:href)\s*=\s*["']?\s*javascript:/iu.test(svg)) {
    throw new Error('Mermaid returned unsafe or invalid SVG');
  }
  return svg;
}

async function renderLiveMermaid(container: HTMLElement, source: string): Promise<void> {
  const renderThemeRevision = colorThemeRevision;
  try {
    const mermaid = await loadMermaid();
    if (!container.isConnected) return;
    initializeMermaid(mermaid);
    const result = await mermaid.render(`markda-live-${crypto.randomUUID()}`, source);
    if (container.isConnected && renderThemeRevision === colorThemeRevision) {
      container.innerHTML = validateMermaidSvg(result.svg);
    } else if (container.isConnected) {
      void renderLiveMermaid(container, source);
    }
  } catch (error) {
    if (container.isConnected) {
      container.classList.add('markda-render-error');
      container.title = String(error);
      container.textContent = source;
    }
  }
}

class TocWidget extends WidgetType {
  private readonly headings;
  private readonly signature;
  constructor(private readonly editor: EditorView, private readonly from: number) {
    super();
    this.headings = headingAnchors(editor.state.doc.toString());
    this.signature = this.headings.map((heading) => `${heading.level}:${heading.slug}:${heading.text}`).join('\n');
  }
  toDOM(): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'markda-live-toc';
    nav.setAttribute('aria-label', t('tableOfContents'));
    const title = document.createElement('strong');
    title.textContent = t('tableOfContents');
    const list = document.createElement('ol');
    const headings = this.headings;
    const minimum = headings.length ? Math.min(...headings.map((heading) => heading.level)) : 1;
    for (const heading of headings) {
      const item = document.createElement('li');
      item.style.setProperty('--markda-toc-depth', String(Math.max(0, heading.level - minimum)));
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = heading.text;
      button.addEventListener('click', () => {
        this.editor.dispatch({
          selection: EditorSelection.cursor(heading.from),
          effects: EditorView.scrollIntoView(heading.from, { y: 'center' }),
        });
        this.editor.focus();
      });
      item.append(button);
      list.append(item);
    }
    if (!headings.length) {
      const empty = document.createElement('span');
      empty.className = 'markda-toc-empty';
      empty.textContent = t('tocEmpty');
      nav.append(title, empty);
    } else {
      nav.append(title, list);
    }
    return nav;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: TocWidget): boolean {
    return other.from === this.from && other.signature === this.signature;
  }
}

class EmojiWidget extends WidgetType {
  constructor(private readonly value: string, private readonly name: string) { super(); }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'markda-emoji';
    span.textContent = this.value;
    span.title = `:${this.name}:`;
    span.setAttribute('aria-label', this.name.replaceAll('_', ' '));
    return span;
  }
  eq(other: EmojiWidget): boolean { return other.value === this.value && other.name === this.name; }
}

class FrontMatterWidget extends WidgetType {
  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly to: number,
    private readonly source: string,
  ) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('section');
    container.className = 'markda-front-matter';
    const header = document.createElement('div');
    header.className = 'markda-front-matter-header';
    const title = document.createElement('strong');
    title.textContent = t('frontMatter');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = t('editYaml');
    header.append(title, toggle);
    const fields = document.createElement('div');
    fields.className = 'markda-front-matter-fields';
    const sourceEditor = createBlockSourceEditor(this.editor, this.source, (value) => {
      commitFrontMatter(this.editor, this.from, value);
    });
    sourceEditor.classList.add('markda-front-matter-source');
    sourceEditor.hidden = true;
    const loading = document.createElement('span');
    loading.className = 'markda-toc-empty';
    loading.textContent = t('loadingYaml');
    fields.append(loading);
    void loadYaml().then((yamlApi) => {
      if (!container.isConnected) return;
      fields.replaceChildren();
      const yaml = yamlApi.parseDocument(this.source, { keepSourceTokens: true });
      if (yaml.errors.length || !yamlApi.isMap(yaml.contents)) {
        const error = document.createElement('div');
        error.className = 'markda-front-matter-error';
        error.textContent = yaml.errors[0]?.message ?? 'Front Matter must contain a YAML mapping.';
        fields.append(error);
        sourceEditor.hidden = false;
        toggle.hidden = true;
        return;
      }
      for (const pair of yaml.contents.items) {
        const key = yamlApi.isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const row = document.createElement('label');
        const label = document.createElement('span');
        label.textContent = key;
        if (yamlApi.isScalar(pair.value) || pair.value === null) {
          const input = document.createElement('input');
          input.value = pair.value === null ? '' : String(pair.value.value ?? '');
          input.addEventListener('change', () => {
            yaml.set(key, yamlApi.parse(input.value));
            commitFrontMatter(this.editor, this.from, String(yaml).trimEnd());
          });
          row.append(label, input);
        } else {
          const value = document.createElement('code');
          value.textContent = String(pair.value).trim().replace(/\s+/gu, ' ');
          value.title = t('nestedYaml');
          row.append(label, value);
        }
        fields.append(row);
      }
      if (!yaml.contents.items.length) {
        const empty = document.createElement('span');
        empty.className = 'markda-toc-empty';
        empty.textContent = t('yamlEmpty');
        fields.append(empty);
      }
    }).catch((error: unknown) => {
      fields.replaceChildren();
      const message = document.createElement('div');
      message.className = 'markda-front-matter-error';
      message.textContent = String(error);
      fields.append(message);
      sourceEditor.hidden = false;
    });
    toggle.addEventListener('click', () => {
      sourceEditor.hidden = !sourceEditor.hidden;
      fields.hidden = !sourceEditor.hidden;
      toggle.textContent = sourceEditor.hidden ? 'Edit YAML' : 'Show fields';
      if (!sourceEditor.hidden) sourceEditor.focus();
    });
    sourceEditor.addEventListener('focus', () => { activeFrontMatterFrom = this.from; });
    sourceEditor.addEventListener('blur', () => {
      if (activeFrontMatterFrom === this.from) activeFrontMatterFrom = undefined;
      requestLivePreviewRefresh(this.editor);
    });
    container.append(header, fields, sourceEditor);
    return container;
  }

  ignoreEvent(): boolean { return true; }
  eq(other: FrontMatterWidget): boolean {
    return other.from === this.from && (activeFrontMatterFrom === this.from
      || (other.to === this.to && other.source === this.source));
  }
}

function loadYaml(): Promise<typeof import('yaml')> {
  return yamlPromise ??= import('./yamlLoader.js').then((module) => module.api);
}

function commitFrontMatter(editor: EditorView, from: number, yaml: string): void {
  const opening = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  if (!/^---\s*$/u.test(opening.text)) return;
  let endLine = opening.number + 1;
  while (endLine <= editor.state.doc.lines && !/^(?:---|\.\.\.)\s*$/u.test(editor.state.doc.line(endLine).text)) endLine++;
  if (endLine > editor.state.doc.lines) return;
  const to = editor.state.doc.line(endLine).to;
  const eol = editor.state.doc.toString().match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const replacement = `---${eol}${yaml.replace(/\r\n?|\n/gu, eol).trim()}${eol}---`;
  if (editor.state.sliceDoc(from, to) !== replacement) editor.dispatch({ changes: { from, to, insert: replacement } });
}

class ThematicBreakWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number) { super(); }
  toDOM(): HTMLElement {
    const rule = document.createElement('hr');
    rule.className = 'markda-thematic-break';
    rule.title = t('horizontalRule');
    rule.addEventListener('click', () => {
      livePreviewSelectionFocused = true;
      this.editor.dispatch({ selection: EditorSelection.cursor(this.from) });
      this.editor.focus();
      requestAnimationFrame(() => {
        if (this.editor.dom.isConnected) {
          this.editor.dispatch({ selection: EditorSelection.cursor(this.from) });
        }
      });
    });
    return rule;
  }
  ignoreEvent(event: Event): boolean { return event.type !== 'click'; }
  eq(other: ThematicBreakWidget): boolean { return other.from === this.from; }
}

function prepareLiveMath(source: string, displayMode: boolean): string {
  const documentSource = view.state.doc.toString();
  if (!mathReferenceCache || mathReferenceCache.source !== documentSource) {
    mathReferenceCache = { source: documentSource, references: collectMathReferences(documentSource) };
  }
  return prepareMathExpression(source, mathReferenceCache.references, displayMode);
}

function requestLivePreviewRefresh(editor: EditorView): void {
  // A widget can lose focus while CodeMirror is synchronously reconciling its
  // DOM. Dispatching from that blur handler re-enters EditorView.update and
  // throws. A microtask runs immediately after the reconciliation completes.
  queueMicrotask(() => {
    if (editor.dom.isConnected) editor.dispatch({ effects: refreshLivePreview.of(null) });
  });
}

class SoftBreakWidget extends WidgetType {
  toDOM(): HTMLElement {
    const space = document.createElement('span');
    space.className = 'markda-soft-break';
    space.textContent = ' ';
    space.setAttribute('aria-hidden', 'true');
    return space;
  }
}

class TrailingParagraphWidget extends WidgetType {
  constructor(private readonly editor: EditorView) { super(); }
  toDOM(): HTMLElement {
    const target = document.createElement('div');
    target.className = 'markda-trailing-paragraph';
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.setAttribute('aria-label', t('addParagraph'));
    target.title = t('addParagraph');
    const append = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      appendParagraphAfterTerminalBlock(this.editor);
    };
    target.addEventListener('click', append);
    target.addEventListener('keydown', append);
    return target;
  }
  ignoreEvent(): boolean { return true; }
}

function appendParagraphAfterTerminalBlock(editor: EditorView): void {
  const text = editor.state.doc.toString();
  const eol = text.match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const insert = text.endsWith(eol) ? eol : `${eol}${eol}`;
  const from = editor.state.doc.length;
  editor.dispatch({
    changes: { from, insert },
    selection: EditorSelection.cursor(from + insert.length),
    scrollIntoView: true,
  });
  editor.focus();
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

class InlineImageWidget extends WidgetType {
  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly alt: string,
    private readonly source: string,
  ) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'markda-inline-image';
    container.tabIndex = 0;
    container.setAttribute('role', 'button');
    container.setAttribute('aria-label', t('imageEdit', this.alt || this.source));
    container.title = t('imageEdit', this.alt || t('image'));
    if (/^https?:/iu.test(this.source) && settings.security.allowRemoteResources !== 'always') {
      container.classList.add('markda-inline-image-blocked');
      container.textContent = this.alt || t('remoteImage');
    } else {
      const image = document.createElement('img');
      image.alt = this.alt;
      try {
        image.src = /^(?:data:|vscode-webview:)/iu.test(this.source)
          ? this.source
          : new URL(this.source, resourceBaseUri).toString();
        container.append(image);
      } catch {
        container.textContent = this.alt || this.source;
      }
    }
    const edit = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      livePreviewSelectionFocused = true;
      this.editor.dispatch({ selection: EditorSelection.cursor(this.from + 2) });
      this.editor.focus();
    };
    container.addEventListener('click', edit);
    container.addEventListener('keydown', edit);
    return container;
  }

  ignoreEvent(event: Event): boolean { return event.type !== 'click' && event.type !== 'keydown'; }
  eq(other: InlineImageWidget): boolean {
    return other.from === this.from && other.alt === this.alt && other.source === this.source;
  }
}

class FootnoteReferenceWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly label: string) { super(); }

  toDOM(): HTMLElement {
    const reference = document.createElement('sup');
    reference.className = 'markda-footnote-reference';
    reference.tabIndex = 0;
    reference.setAttribute('role', 'button');
    reference.setAttribute('aria-label', t('footnoteEdit', this.label));
    reference.title = t('footnoteEdit', this.label);
    reference.textContent = this.label;
    const edit = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      livePreviewSelectionFocused = true;
      this.editor.dispatch({ selection: EditorSelection.cursor(this.from + 2) });
      this.editor.focus();
    };
    reference.addEventListener('click', edit);
    reference.addEventListener('keydown', edit);
    return reference;
  }

  ignoreEvent(event: Event): boolean { return event.type !== 'click' && event.type !== 'keydown'; }
  eq(other: FootnoteReferenceWidget): boolean { return other.from === this.from && other.label === this.label; }
}

class InlineHtmlWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly source: string) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'markda-inline-html';
    container.tabIndex = 0;
    container.setAttribute('role', 'button');
    container.setAttribute('aria-label', t('inlineHtmlEdit'));
    container.title = t('inlineHtmlEdit');
    container.innerHTML = sanitizeHtmlFragment(this.source);
    removeUnsafeHtmlNodes(container);
    secureRenderedHtml(container);
    const edit = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      livePreviewSelectionFocused = true;
      this.editor.dispatch({ selection: EditorSelection.cursor(this.from + 1) });
      this.editor.focus();
    };
    container.addEventListener('click', edit);
    container.addEventListener('keydown', edit);
    return container;
  }

  ignoreEvent(event: Event): boolean { return event.type !== 'click' && event.type !== 'keydown'; }
  eq(other: InlineHtmlWidget): boolean { return other.from === this.from && other.source === this.source; }
}

class EntityWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly source: string) { super(); }

  toDOM(): HTMLElement {
    const value = document.createElement('span');
    const decoded = decodeHtmlEntity(this.source);
    value.className = 'markda-entity';
    value.tabIndex = 0;
    value.setAttribute('role', 'button');
    value.setAttribute('aria-label', t('entityEdit', decoded));
    value.title = t('entityEdit', value.textContent ?? '');
    value.textContent = decoded;
    const edit = () => {
      livePreviewSelectionFocused = true;
      this.editor.dispatch({ selection: EditorSelection.cursor(this.from + 1) });
      this.editor.focus();
    };
    value.addEventListener('click', edit);
    value.addEventListener('keydown', (event) => activateOnKeyboard(event, edit));
    return value;
  }

  ignoreEvent(event: Event): boolean { return event.type !== 'click' && event.type !== 'keydown'; }
  eq(other: EntityWidget): boolean { return other.from === this.from && other.source === this.source; }
}

class FootnoteDefinitionWidget extends WidgetType {
  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly label: string,
    private readonly content: string,
  ) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-footnote-definition';
    const label = document.createElement('sup');
    label.textContent = this.label;
    label.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    content.className = 'markda-footnote-definition-content';
    content.contentEditable = 'true';
    content.spellcheck = true;
    content.setAttribute('aria-label', t('footnoteContent', this.label));
    content.textContent = this.content;
    const gate = new CompositionCommitGate();
    let timer: number | undefined;
    let dirty = false;
    const commit = () => commitFootnoteDefinition(this.editor, this.from, this.label, editablePlainText(content));
    const commitIfDirty = () => {
      if (!dirty) return;
      dirty = false;
      commit();
    };
    nestedEditableFlushers.set(content, () => {
      window.clearTimeout(timer);
      timer = undefined;
      gate.flush(commitIfDirty);
    });
    content.addEventListener('input', () => {
      dirty = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; gate.request(commitIfDirty); }, 80);
    });
    content.addEventListener('compositionstart', () => gate.start());
    content.addEventListener('compositionend', () => gate.end(commitIfDirty));
    content.addEventListener('keydown', (event) => {
      runEditableHistoryShortcut(event, this.editor, () => {
        window.clearTimeout(timer);
        gate.flush(commitIfDirty);
      });
    });
    content.addEventListener('blur', () => {
      window.clearTimeout(timer);
      gate.flush(commitIfDirty);
    });
    container.append(label, content);
    return container;
  }

  ignoreEvent(): boolean { return true; }
  eq(other: FootnoteDefinitionWidget): boolean {
    return other.from === this.from && other.label === this.label && other.content === this.content;
  }
}

class ReferenceDefinitionWidget extends WidgetType {
  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly label: string,
    private readonly definition: MarkdownReferenceDefinition,
  ) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-reference-definition';
    const labelInput = document.createElement('input');
    labelInput.value = this.label;
    labelInput.setAttribute('aria-label', t('referenceLabel'));
    const destinationInput = document.createElement('input');
    destinationInput.value = this.definition.destination;
    destinationInput.setAttribute('aria-label', t('referenceDestination'));
    const titleInput = document.createElement('input');
    titleInput.value = this.definition.title ?? '';
    titleInput.placeholder = t('optionalTitle');
    titleInput.setAttribute('aria-label', t('referenceTitle'));
    const commit = () => commitReferenceDefinition(
      this.editor, this.from, labelInput.value, destinationInput.value, titleInput.value,
    );
    for (const input of [labelInput, destinationInput, titleInput]) {
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (runEditableHistoryShortcut(event, this.editor, commit)) return;
        if (event.key === 'Enter') input.blur();
      });
    }
    container.append(labelInput, document.createTextNode('→'), destinationInput, titleInput);
    return container;
  }

  ignoreEvent(): boolean { return true; }
  eq(other: ReferenceDefinitionWidget): boolean {
    return other.from === this.from && other.label === this.label
      && other.definition.destination === this.definition.destination
      && other.definition.title === this.definition.title;
  }
}

class HtmlBlockWidget extends WidgetType {
  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly source: string,
    private readonly editable: boolean,
  ) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-html-block';
    container.setAttribute('aria-label', t('htmlBlock'));
    const content = document.createElement('div');
    content.className = 'markda-html-block-content';
    content.contentEditable = String(this.editable);
    content.spellcheck = this.editable;
    content.innerHTML = sanitizeHtmlFragment(this.source);
    removeUnsafeHtmlNodes(content);
    secureRenderedHtml(content);
    if (!content.childNodes.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'markda-html-empty';
      placeholder.textContent = t('emptyHtmlBlock');
      content.append(placeholder);
    }
    container.append(content);
    if (!this.editable) return container;
    const gate = new CompositionCommitGate();
    let timer: number | undefined;
    let dirty = false;
    const commit = () => commitHtmlBlock(this.editor, this.from, content.innerHTML);
    const commitIfDirty = () => {
      if (!dirty) return;
      dirty = false;
      commit();
    };
    nestedEditableFlushers.set(content, () => {
      window.clearTimeout(timer);
      gate.flush(commitIfDirty);
    });
    content.addEventListener('focus', () => { activeHtmlFrom = this.from; });
    content.addEventListener('input', () => {
      dirty = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; gate.request(commitIfDirty); }, 100);
    });
    content.addEventListener('compositionstart', () => gate.start());
    content.addEventListener('compositionend', () => gate.end(commitIfDirty));
    content.addEventListener('keydown', (event) => {
      runEditableHistoryShortcut(event, this.editor, () => {
        window.clearTimeout(timer);
        gate.flush(commitIfDirty);
      });
    });
    content.addEventListener('blur', () => {
      window.clearTimeout(timer);
      gate.flush(commitIfDirty);
      if (activeHtmlFrom === this.from) activeHtmlFrom = undefined;
      requestLivePreviewRefresh(this.editor);
    });
    return container;
  }

  ignoreEvent(): boolean { return true; }
  eq(other: HtmlBlockWidget): boolean {
    return other.from === this.from && other.editable === this.editable
      && (activeHtmlFrom === this.from || other.source === this.source);
  }
}

class ImageWidget extends WidgetType {
  private disposeEditor: (() => void) | undefined;

  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly alt: string,
    private readonly source: string,
    private readonly title = '',
  ) { super(); }
  toDOM(): HTMLElement {
    const figure = document.createElement('figure');
    figure.className = 'markda-live-image';
    const configuredWidth = this.title.match(/^width=(\d{1,3})%$/u)?.[1];
    if (configuredWidth) figure.style.width = `${Math.max(10, Math.min(100, Number(configuredWidth)))}%`;
    const image = document.createElement('img');
    image.alt = this.alt;
    if (/^https?:/iu.test(this.source) && settings.security.allowRemoteResources !== 'always') {
      const blocked = document.createElement('span');
      blocked.className = 'markda-remote-blocked';
      blocked.textContent = t('remoteImageBlocked', this.alt || this.source);
      figure.append(blocked);
    } else {
      try { image.src = /^(?:data:|vscode-webview:)/iu.test(this.source) ? this.source : new URL(this.source, resourceBaseUri).toString(); }
      catch { image.alt = this.alt || this.source; }
      figure.append(image);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = this.alt || t('image');
    figure.append(caption);
    const controls = document.createElement('div');
    controls.className = 'markda-image-controls';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = t('editHere');
    controls.append(editButton);
    if (!/^(?:https?:|data:|vscode-webview:)/iu.test(this.source)) {
      const actions: readonly ['move' | 'copy' | 'delete', string][] = [
        ['move', t('moveRename')],
        ['copy', t('copyAction')],
        ['delete', t('deleteAction')],
      ];
      for (const [action, label] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => vscode.postMessage({ type: 'manageImage', source: this.source, from: this.from, action }));
        controls.append(button);
      }
    }
    figure.append(controls);
    const editorPanel = document.createElement('div');
    editorPanel.className = 'markda-image-editor';
    editorPanel.hidden = true;
    const altInput = document.createElement('input');
    altInput.value = this.alt;
    altInput.placeholder = t('imageAlt');
    const sourceInput = document.createElement('input');
    sourceInput.value = this.source;
    sourceInput.placeholder = t('imagePathOrUrl');
    const widthLabel = document.createElement('label');
    widthLabel.textContent = t('imageWidth');
    const widthInput = document.createElement('input');
    widthInput.type = 'range';
    widthInput.min = '10';
    widthInput.max = '100';
    widthInput.value = configuredWidth ?? '100';
    widthInput.setAttribute('aria-label', t('imageWidth'));
    widthLabel.append(widthInput);
    const commit = () => commitImage(this.editor, this.from, altInput.value, sourceInput.value,
      Number(widthInput.value) < 100 ? `width=${widthInput.value}%` : '');
    altInput.addEventListener('change', commit);
    sourceInput.addEventListener('change', commit);
    widthInput.addEventListener('input', () => { figure.style.width = `${widthInput.value}%`; });
    widthInput.addEventListener('change', commit);
    editorPanel.append(altInput, sourceInput, widthLabel);
    editorPanel.addEventListener('focusin', () => { activeImageFrom = this.from; });
    editorPanel.addEventListener('focusout', () => queueMicrotask(() => {
      if (editorPanel.contains(document.activeElement)) return;
      if (activeImageFrom === this.from) activeImageFrom = undefined;
      requestLivePreviewRefresh(this.editor);
    }));
    figure.append(editorPanel);
    const editorBinding = bindWidgetEditor(this.editor, editorPanel, image.isConnected ? image : caption, figure);
    this.disposeEditor = editorBinding.dispose;
    const edit = editorBinding.toggle;
    editButton.addEventListener('click', edit);
    figure.addEventListener('dblclick', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('button,input')) edit();
    });
    return figure;
  }
  ignoreEvent(): boolean { return true; }
  destroy(): void { this.disposeEditor?.(); }
  eq(other: ImageWidget): boolean {
    return other.from === this.from && (activeImageFrom === this.from
      || (other.source === this.source && other.alt === this.alt && other.title === this.title));
  }
}

function commitImage(editor: EditorView, from: number, alt: string, source: string, title = ''): void {
  const line = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  if (!/^\s*!\[[^\]]*\]\([^)]+\)\s*$/u.test(line.text)) return;
  const indentation = line.text.match(/^\s*/u)?.[0] ?? '';
  const safeAlt = alt.replaceAll(']', '\\]');
  const safeSource = source.replaceAll(')', '\\)');
  const safeTitle = title.replaceAll('"', '\\"');
  editor.dispatch({ changes: { from: line.from, to: line.to, insert: `${indentation}![${safeAlt}](${safeSource}${safeTitle ? ` "${safeTitle}"` : ''})` } });
}

class IndentedCodeWidget extends WidgetType {
  constructor(private readonly editor: EditorView, private readonly from: number, private readonly source: string) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-live-code markda-indented-code';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.contentEditable = 'true';
    code.spellcheck = false;
    code.setAttribute('aria-label', t('indentedCode'));
    code.textContent = this.source;
    const gate = new CompositionCommitGate();
    let timer: number | undefined;
    let dirty = false;
    const commit = () => commitIndentedCode(this.editor, this.from, editablePlainText(code));
    const commitIfDirty = () => {
      if (!dirty) return;
      dirty = false;
      commit();
    };
    nestedEditableFlushers.set(code, () => {
      window.clearTimeout(timer);
      gate.flush(commitIfDirty);
    });
    code.addEventListener('input', () => {
      dirty = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; gate.request(commitIfDirty); }, 80);
    });
    code.addEventListener('compositionstart', () => gate.start());
    code.addEventListener('compositionend', () => gate.end(commitIfDirty));
    code.addEventListener('keydown', (event) => {
      if (runEditableHistoryShortcut(event, this.editor, () => {
        window.clearTimeout(timer);
        gate.flush(commitIfDirty);
      })) return;
      if (event.key !== 'Enter' && event.key !== 'Tab') return;
      event.preventDefault();
      insertTextIntoEditable(code, event.key === 'Enter' ? '\n' : '  ');
    });
    code.addEventListener('blur', () => {
      window.clearTimeout(timer);
      gate.flush(commitIfDirty);
    });
    pre.append(code);
    container.append(pre);
    return container;
  }

  ignoreEvent(): boolean { return true; }
  eq(other: IndentedCodeWidget): boolean { return other.from === this.from && other.source === this.source; }
}

type GitHubSyntaxToken = 'comment' | 'constant' | 'entity' | 'keyword' | 'string' | 'variable';

const codeKeywords = new Set([
  'abstract', 'and', 'as', 'async', 'await', 'base', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'def', 'default', 'defer', 'delete', 'do', 'elif', 'else', 'enum', 'except', 'export', 'extends',
  'final', 'finally', 'fn', 'for', 'from', 'func', 'function', 'global', 'goto', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'internal', 'is', 'lambda', 'let', 'match', 'module', 'namespace', 'native',
  'new', 'not', 'of', 'or', 'override', 'package', 'pass', 'private', 'protected',
  'public', 'raise', 'readonly', 'record', 'return', 'sealed', 'sizeof', 'static', 'struct', 'super', 'switch',
  'this', 'throw', 'trait', 'try', 'type', 'typeof', 'union', 'unsafe', 'use', 'using',
  'var', 'virtual', 'void', 'when', 'where', 'while', 'with', 'yield',
]);

const codeTypes = new Set([
  'any', 'bigint', 'bool', 'boolean', 'byte', 'char', 'decimal', 'double', 'float', 'int', 'integer', 'long',
  'never', 'number', 'object', 'sbyte', 'short', 'string', 'symbol', 'uint', 'ulong', 'unknown', 'ushort',
]);

function appendSyntaxToken(parent: DocumentFragment, value: string, token?: GitHubSyntaxToken): void {
  if (!token) {
    parent.append(document.createTextNode(value));
    return;
  }
  const span = document.createElement('span');
  span.className = `markda-syntax-${token}`;
  span.textContent = value;
  parent.append(span);
}

function highlightCode(code: HTMLElement, source: string, language: string): void {
  const fragment = document.createDocumentFragment();
  const normalizedLanguage = language.toLowerCase().replace(/^language-/u, '');
  const markup = /^(?:html?|xml|svg|vue|svelte|jsx|tsx)$/u.test(normalizedLanguage);
  const hashComments = /^(?:py|python|rb|ruby|sh|shell|bash|zsh|fish|yaml|yml|toml|perl|r)$/u.test(normalizedLanguage);
  const sql = /^(?:sql|pgsql|mysql)$/u.test(normalizedLanguage);
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const comment = rest.match(hashComments ? /^(?:#[^\n]*|\/\*[\s\S]*?\*\/)/u : /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/u);
    if (comment) {
      appendSyntaxToken(fragment, comment[0], 'comment');
      index += comment[0].length;
      continue;
    }
    if (markup) {
      const markupComment = rest.match(/^<!--[\s\S]*?(?:-->|$)/u);
      if (markupComment) {
        appendSyntaxToken(fragment, markupComment[0], 'comment');
        index += markupComment[0].length;
        continue;
      }
      const tag = rest.match(/^<\/?[A-Za-z][\w:.-]*/u);
      if (tag) {
        appendSyntaxToken(fragment, tag[0], 'entity');
        index += tag[0].length;
        continue;
      }
      const attribute = rest.match(/^[A-Za-z_:][\w:.-]*(?=\s*=)/u);
      if (attribute) {
        appendSyntaxToken(fragment, attribute[0], 'variable');
        index += attribute[0].length;
        continue;
      }
    }
    const string = rest.match(/^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)/u);
    if (string) {
      appendSyntaxToken(fragment, string[0], 'string');
      index += string[0].length;
      continue;
    }
    const number = rest.match(/^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:[nfd])?/iu);
    if (number) {
      appendSyntaxToken(fragment, number[0], 'constant');
      index += number[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_$][\w$]*/u);
    if (word) {
      const value = word[0];
      const lowered = value.toLowerCase();
      const after = source.slice(index + value.length);
      let token: GitHubSyntaxToken | undefined;
      if (codeKeywords.has(lowered) || (sql && /^(?:select|insert|update|delete|from|where|join|on|group|order|by|having|limit|offset|into|values|create|alter|drop|table|index|view|distinct|all|union)$/u.test(lowered))) {
        token = 'keyword';
      } else if (codeTypes.has(lowered) || /^[A-Z][\w$]*$/u.test(value)) {
        token = 'entity';
      } else if (/^\s*\(/u.test(after)) {
        token = 'entity';
      } else if (/^(?:true|false|null|none|nil|undefined)$/u.test(lowered)) {
        token = 'constant';
      }
      appendSyntaxToken(fragment, value, token);
      index += value.length;
      continue;
    }
    appendSyntaxToken(fragment, source[index]!);
    index += 1;
  }
  code.replaceChildren(fragment);
}

function codeSelectionOffset(code: HTMLElement): number | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return undefined;
  const range = selection.getRangeAt(0);
  if (!code.contains(range.startContainer)) return undefined;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(code);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

function restoreCodeSelection(code: HTMLElement, offset: number | undefined): void {
  if (offset === undefined) return;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }
}

function refreshCodeHighlight(code: HTMLElement, language: string): void {
  const offset = codeSelectionOffset(code);
  const source = editablePlainText(code);
  highlightCode(code, source, language);
  restoreCodeSelection(code, offset);
}

class CodeBlockWidget extends WidgetType {
  private disposeEditor: (() => void) | undefined;

  constructor(
    private readonly editor: EditorView,
    private readonly from: number,
    private readonly source: string,
    private readonly language: string,
  ) { super(); }
  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-live-code';
    if (this.language === 'math' || this.language === 'latex') {
      const rendered = document.createElement('div');
      rendered.className = 'markda-code-rendered';
      rendered.textContent = this.source;
      rendered.tabIndex = 0;
      rendered.setAttribute('role', 'button');
      rendered.setAttribute('aria-label', t('editMath'));
      const sourceEditor = createBlockSourceEditor(this.editor, this.source,
        (value) => commitCodeBlock(this.editor, this.from, value, undefined));
      sourceEditor.hidden = true;
      sourceEditor.addEventListener('focus', () => { activeCodeFrom = this.from; });
      sourceEditor.addEventListener('blur', () => {
        if (activeCodeFrom === this.from) activeCodeFrom = undefined;
        requestLivePreviewRefresh(this.editor);
      });
      const editorBinding = bindWidgetEditor(this.editor, sourceEditor, rendered, container);
      this.disposeEditor = editorBinding.dispose;
      const toggle = editorBinding.toggle;
      rendered.title = t('editMathClick');
      rendered.addEventListener('click', toggle);
      rendered.addEventListener('keydown', (event) => activateOnKeyboard(event, toggle));
      container.append(rendered, sourceEditor);
      void renderKatexInto(rendered, this.source, true);
    } else if (this.language === 'mermaid' && settings.markdown.diagrams) {
      const rendered = document.createElement('div');
      rendered.className = 'markda-code-rendered';
      rendered.textContent = this.source;
      rendered.dataset.markdaRenderer = 'mermaid';
      rendered.dataset.markdaSource = this.source;
      rendered.tabIndex = 0;
      rendered.setAttribute('role', 'button');
      rendered.setAttribute('aria-label', t('editMermaid'));
      const sourceEditor = createBlockSourceEditor(this.editor, this.source,
        (value) => commitCodeBlock(this.editor, this.from, value, undefined));
      sourceEditor.hidden = true;
      sourceEditor.addEventListener('focus', () => { activeCodeFrom = this.from; });
      sourceEditor.addEventListener('blur', () => {
        if (activeCodeFrom === this.from) activeCodeFrom = undefined;
        requestLivePreviewRefresh(this.editor);
      });
      const editorBinding = bindWidgetEditor(this.editor, sourceEditor, rendered, container);
      this.disposeEditor = editorBinding.dispose;
      const toggle = editorBinding.toggle;
      rendered.title = t('editMermaidClick');
      rendered.addEventListener('click', toggle);
      rendered.addEventListener('keydown', (event) => activateOnKeyboard(event, toggle));
      container.append(rendered, sourceEditor);
      void renderLiveMermaid(rendered, this.source);
    } else {
      container.classList.add('markda-fenced-code');
      const pre = document.createElement('pre');
      const toolbar = document.createElement('div');
      toolbar.className = 'markda-code-toolbar';
      const language = document.createElement('input');
      language.value = this.language;
      language.placeholder = t('codeLanguage');
      language.setAttribute('aria-label', t('codeLanguage'));
      language.setAttribute('list', 'markda-code-languages');
      language.addEventListener('change', () => commitCodeBlock(this.editor, this.from, undefined, language.value.trim()));
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.title = t('copyCode');
      copy.setAttribute('aria-label', t('copyCode'));
      copy.innerHTML = '<i class="codicon codicon-copy" aria-hidden="true"></i>';
      copy.addEventListener('click', () => vscode.postMessage({ type: 'copyToClipboard', text: editablePlainText(code) }));
      toolbar.append(language, copy);
      const code = document.createElement('code');
      code.className = this.language ? `language-${this.language}` : '';
      code.textContent = this.source;
      code.contentEditable = 'true';
      code.spellcheck = false;
      code.setAttribute('aria-label', t('codeContent'));
      highlightCode(code, this.source, this.language);
      const gate = new CompositionCommitGate();
      let timer: number | undefined;
      let dirty = false;
      let composing = false;
      const commit = () => commitCodeBlock(this.editor, this.from, editablePlainText(code), undefined);
      const commitIfDirty = () => {
        if (!dirty) return;
        dirty = false;
        commit();
      };
      nestedEditableFlushers.set(code, () => {
        window.clearTimeout(timer);
        timer = undefined;
        gate.flush(commitIfDirty);
      });
      code.addEventListener('focus', () => { activeCodeFrom = this.from; });
      code.addEventListener('input', () => {
        dirty = true;
        if (!composing) refreshCodeHighlight(code, this.language);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { timer = undefined; gate.request(commitIfDirty); }, 80);
      });
      code.addEventListener('compositionstart', () => {
        composing = true;
        gate.start();
      });
      code.addEventListener('compositionend', () => {
        composing = false;
        refreshCodeHighlight(code, this.language);
        gate.end(commitIfDirty);
      });
      code.addEventListener('keydown', (event) => {
        if (runEditableHistoryShortcut(event, this.editor, () => {
          window.clearTimeout(timer);
          timer = undefined;
          gate.flush(commitIfDirty);
        })) return;
        if (event.key !== 'Enter' && event.key !== 'Tab') return;
        event.preventDefault();
        insertTextIntoEditable(code, event.key === 'Enter' ? '\n' : '  ');
      });
      code.addEventListener('blur', () => {
        window.clearTimeout(timer);
        gate.flush(commitIfDirty);
        if (activeCodeFrom === this.from) activeCodeFrom = undefined;
      });
      pre.append(code);
      container.append(toolbar, pre);
    }
    return container;
  }
  ignoreEvent(): boolean { return true; }
  destroy(): void { this.disposeEditor?.(); }
  eq(other: CodeBlockWidget): boolean {
    return other.from === this.from
      && (activeCodeFrom === this.from || (other.source === this.source && other.language === this.language));
  }
}

function commitIndentedCode(editor: EditorView, from: number, source: string): void {
  const opening = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  if (!/^(?: {4}|\t)/u.test(opening.text)) return;
  let endLine = opening.number;
  while (endLine < editor.state.doc.lines) {
    const next = editor.state.doc.line(endLine + 1).text;
    if (next && !/^(?: {4}|\t)/u.test(next)) break;
    endLine++;
  }
  while (endLine > opening.number && !editor.state.doc.line(endLine).text) endLine--;
  const to = editor.state.doc.line(endLine).to;
  const eol = editor.state.doc.toString().match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const replacement = source.replace(/\r\n?/gu, '\n').split('\n')
    .map((line) => line ? `    ${line}` : '')
    .join(eol);
  if (editor.state.sliceDoc(opening.from, to) !== replacement) {
    editor.dispatch({ changes: { from: opening.from, to, insert: replacement } });
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
    const replacement = source.replace(/\r?\n$/u, '');
    if (editor.state.sliceDoc(contentFrom, contentTo) !== replacement) {
      changes.push({ from: contentFrom, to: contentTo, insert: replacement });
    }
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
  private disposeEditor: (() => void) | undefined;

  constructor(private readonly editor: EditorView, private readonly table: MarkdownTable) { super(); }
  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'markda-live-table-wrap';
    container.dataset.tableFrom = String(this.table.from);
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', t('editableTable'));
    const cellCount = (this.table.rows.length + 1) * this.table.header.length;
    if (cellCount > settings.liveTableMaxCells) {
      container.classList.add('markda-large-table');
      const summary = document.createElement('span');
      summary.textContent = t('largeTable', this.table.rows.length + 1, this.table.header.length);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = t('editHere');
      const sourceEditor = createBlockSourceEditor(this.editor, serializeMarkdownTable(this.table), (value) => {
        const current = findMarkdownTable(this.editor.state.doc.toString(), this.table.from,
          this.editor.state.doc.lineAt(this.table.from).number - 1);
        if (current) this.editor.dispatch({ changes: { from: current.from, to: current.to, insert: value } });
      });
      sourceEditor.hidden = true;
      sourceEditor.addEventListener('focus', () => { activeTableFrom = this.table.from; });
      sourceEditor.addEventListener('blur', () => {
        if (activeTableFrom === this.table.from) activeTableFrom = undefined;
        requestLivePreviewRefresh(this.editor);
      });
      const editorBinding = bindWidgetEditor(this.editor, sourceEditor, summary, container);
      this.disposeEditor = editorBinding.dispose;
      edit.addEventListener('click', editorBinding.toggle);
      container.append(summary, edit, sourceEditor);
      return container;
    }
    const tableElement = document.createElement('table');
    const tableHead = document.createElement('thead');
    const tableBody = document.createElement('tbody');
    [this.table.header, ...this.table.rows].forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.draggable = rowIndex > 0;
      row.forEach((cell, column) => {
        const element = document.createElement(rowIndex === 0 ? 'th' : 'td');
        element.contentEditable = 'true';
        element.spellcheck = true;
        element.dataset.tableRow = String(rowIndex - 1);
        element.dataset.tableColumn = String(column);
        let cellSource = cell;
        let editing = false;
        renderInlinePreview(element, cellSource);
        element.style.textAlign = this.table.alignments[column] === 'default' ? '' : this.table.alignments[column] ?? '';
        if (rowIndex === 0) {
          element.draggable = true;
          element.dataset.column = String(column);
          element.title = t('tableInteractionHint');
          element.addEventListener('contextmenu', (event) => { event.preventDefault(); this.cycleAlignment(column); });
        }
        const commitGate = new CompositionCommitGate();
        let commitTimer: number | undefined;
        let dirty = false;
        const enterEditing = () => {
          if (editing) return;
          editing = true;
          element.classList.add('markda-table-cell-editing');
          element.textContent = cellSource;
        };
        const commit = () => this.updateCell(rowIndex - 1, column, cellSource);
        const commitIfDirty = () => {
          if (!dirty) return;
          dirty = false;
          commit();
        };
        nestedEditableFlushers.set(element, () => {
          cellSource = editablePlainText(element);
          window.clearTimeout(commitTimer);
          commitTimer = undefined;
          commitGate.flush(commitIfDirty);
        });
        const scheduleCommit = () => {
          cellSource = editablePlainText(element);
          dirty = true;
          window.clearTimeout(commitTimer);
          commitTimer = window.setTimeout(() => { commitTimer = undefined; commitGate.request(commitIfDirty); }, 80);
        };
        // Pointerdown runs before the browser places the caret, so expose the raw
        // Markdown first and let the click land at the expected source position.
        element.addEventListener('pointerdown', enterEditing);
        element.addEventListener('focus', () => {
          enterEditing();
          activeTableFrom = this.table.from;
          activeLiveTableCursor = { from: this.table.from, row: rowIndex - 1, column };
          updateTableToolbar();
        });
        element.addEventListener('input', scheduleCommit);
        element.addEventListener('compositionstart', () => commitGate.start());
        element.addEventListener('compositionend', () => commitGate.end(commitIfDirty));
        element.addEventListener('blur', () => {
          cellSource = editablePlainText(element);
          window.clearTimeout(commitTimer);
          commitGate.flush(commitIfDirty);
          if (activeTableFrom === this.table.from) activeTableFrom = undefined;
          editing = false;
          element.classList.remove('markda-table-cell-editing');
          renderInlinePreview(element, cellSource);
          queueMicrotask(() => {
            const active = document.activeElement;
            if (document.querySelector('#table-toolbar')?.contains(active) || container.contains(active)) return;
            if (activeLiveTableCursor?.from === this.table.from) activeLiveTableCursor = undefined;
            updateTableToolbar();
          });
        });
        element.addEventListener('keydown', (event) => {
          if (runEditableHistoryShortcut(event, this.editor, () => {
            window.clearTimeout(commitTimer);
            commitTimer = undefined;
            commitGate.flush(commitIfDirty);
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
      (rowIndex === 0 ? tableHead : tableBody).append(tr);
    });
    tableElement.append(tableHead, tableBody);
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
  destroy(): void { this.disposeEditor?.(); }
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
  const scrollTop = editor.scrollDOM.scrollTop;
  const scrollLeft = editor.scrollDOM.scrollLeft;
  // Commit the latest DOM value before popping history. This also covers the
  // debounce window immediately after a keystroke. Blurring makes the widget
  // rebuild from the restored Markdown instead of retaining stale DOM text.
  flush();
  (event.currentTarget as HTMLElement | null)?.blur();
  (command === 'undo' ? undo : redo)(editor);
  editor.focus();
  // CodeMirror history intentionally scrolls the restored selection into view.
  // Nested live editors do not own that selection, so it may still point to a
  // distant source line and make the document appear to jump on Ctrl+Z. Keep the
  // viewport where the user invoked Undo/Redo; the widget itself is rebuilt from
  // the restored Markdown above.
  const restoreScroll = () => {
    editor.scrollDOM.scrollTop = scrollTop;
    editor.scrollDOM.scrollLeft = scrollLeft;
  };
  restoreScroll();
  requestAnimationFrame(() => {
    restoreScroll();
    // A theme can change the restored widget's metrics. CodeMirror may finish
    // measuring that replacement one frame later, so restore once more after
    // its geometry update instead of allowing Undo to nudge the viewport.
    requestAnimationFrame(restoreScroll);
  });
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
  private disposeEditor: (() => void) | undefined;

  constructor(
    private readonly source: string,
    private readonly displayMode: boolean = false,
    private readonly editor?: EditorView,
    private readonly from?: number,
  ) { super(); }
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
    if (this.displayMode && this.editor && this.from !== undefined) {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', t('editMath'));
      const sourceEditor = createBlockSourceEditor(this.editor, this.source,
        (value) => commitBlockMath(this.editor!, this.from!, value));
      sourceEditor.hidden = true;
      const wrapper = document.createElement('div');
      wrapper.className = 'markda-block-math-wrap';
      sourceEditor.addEventListener('focus', () => { activeMathFrom = this.from; });
      sourceEditor.addEventListener('blur', () => {
        if (activeMathFrom === this.from) activeMathFrom = undefined;
        if (this.editor) requestLivePreviewRefresh(this.editor);
      });
      const editorBinding = bindWidgetEditor(this.editor, sourceEditor, element, wrapper);
      this.disposeEditor = editorBinding.dispose;
      element.title = t('editMathClick');
      element.addEventListener('click', editorBinding.toggle);
      element.addEventListener('keydown', (event) => activateOnKeyboard(event, editorBinding.toggle));
      wrapper.append(element, sourceEditor);
      return wrapper;
    }
    if (this.editor && this.from !== undefined) {
      element.title = t('editInlineMathClick');
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', t('editInlineMath'));
      const edit = () => {
        const position = Math.min(this.from! + 1, this.editor!.state.doc.length);
        livePreviewSelectionFocused = true;
        this.editor!.dispatch({ selection: EditorSelection.cursor(position) });
        this.editor!.focus();
      };
      element.addEventListener('click', edit);
      element.addEventListener('keydown', (event) => activateOnKeyboard(event, edit));
    }
    return element;
  }
  eq(other: MathWidget): boolean {
    return other.from === this.from && (activeMathFrom === this.from
      || (other.source === this.source && other.displayMode === this.displayMode));
  }
  ignoreEvent(): boolean {
    // Math owns its click-to-edit and nested textarea events. Letting CodeMirror
    // reinterpret the same gesture as a source selection can replace this widget
    // between mousedown and click, so the editor never opens.
    return true;
  }
  destroy(): void {
    this.disposeEditor?.();
  }
}

function commitBlockMath(editor: EditorView, from: number, source: string): void {
  const opening = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  const inlineBlock = opening.text.match(/^(\s*)\$\$(.+)\$\$\s*$/u);
  if (inlineBlock) {
    editor.dispatch({
      changes: {
        from: opening.from,
        to: opening.to,
        insert: `${inlineBlock[1] ?? ''}$$${source.replace(/\r?\n/gu, ' ').trim()}$$`,
      },
    });
    return;
  }
  if (!/^\s*\$\$\s*$/u.test(opening.text)) return;
  let closing = opening.number + 1;
  while (closing <= editor.state.doc.lines && !/^\s*\$\$\s*$/u.test(editor.state.doc.line(closing).text)) closing++;
  if (closing > editor.state.doc.lines) return;
  const closingLine = editor.state.doc.line(closing);
  const range = codeContentRange(editor.state, opening.to, closingLine.from);
  editor.dispatch({ changes: { from: range.from, to: range.to, insert: source.replace(/\r?\n$/u, '') } });
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
    content.contentEditable = 'true';
    content.spellcheck = true;
    const gate = new CompositionCommitGate();
    let timer: number | undefined;
    let dirty = false;
    const commit = () => commitCallout(this.editor, this.from, this.type, editablePlainText(content));
    const commitIfDirty = () => {
      if (!dirty) return;
      dirty = false;
      commit();
    };
    nestedEditableFlushers.set(content, () => {
      window.clearTimeout(timer);
      timer = undefined;
      gate.flush(commitIfDirty);
    });
    content.addEventListener('focus', () => { activeCalloutFrom = this.from; });
    content.addEventListener('input', () => {
      dirty = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; gate.request(commitIfDirty); }, 80);
    });
    content.addEventListener('compositionstart', () => gate.start());
    content.addEventListener('compositionend', () => gate.end(commitIfDirty));
    content.addEventListener('keydown', (event) => {
      runEditableHistoryShortcut(event, this.editor, () => { window.clearTimeout(timer); gate.flush(commitIfDirty); });
    });
    content.addEventListener('blur', () => {
      window.clearTimeout(timer);
      gate.flush(commitIfDirty);
      if (activeCalloutFrom === this.from) activeCalloutFrom = undefined;
      requestLivePreviewRefresh(this.editor);
    });
    container.append(content);
    return container;
  }
  ignoreEvent(): boolean { return true; }
  eq(other: CalloutWidget): boolean {
    return other.from === this.from && (activeCalloutFrom === this.from
      || (other.type === this.type && other.content === this.content));
  }
}

function createBlockSourceEditor(editor: EditorView, source: string, commit: (value: string) => void): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  input.className = 'markda-block-source-editor';
  input.value = source;
  input.rows = 1;
  input.spellcheck = false;
  input.setAttribute('aria-label', t('blockSource'));
  const gate = new CompositionCommitGate();
  let timer: number | undefined;
  let dirty = false;
  const save = () => commit(input.value);
  const saveIfDirty = () => {
    if (!dirty) return;
    dirty = false;
    save();
  };
  nestedEditableFlushers.set(input, () => {
    window.clearTimeout(timer);
    timer = undefined;
    gate.flush(saveIfDirty);
  });
  input.addEventListener('input', () => {
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = undefined; gate.request(saveIfDirty); }, 80);
  });
  input.addEventListener('compositionstart', () => gate.start());
  input.addEventListener('compositionend', () => gate.end(saveIfDirty));
  input.addEventListener('blur', () => { window.clearTimeout(timer); gate.flush(saveIfDirty); });
  input.addEventListener('keydown', (event) => {
    if (runEditableHistoryShortcut(event, editor, () => { window.clearTimeout(timer); gate.flush(saveIfDirty); })) return;
  });
  return input;
}

function bindWidgetEditor(
  editor: EditorView, input: HTMLElement, rendered: HTMLElement, boundary: HTMLElement,
): { toggle: () => void; dispose: () => void } {
  // The editor-level pointer mapper must not reinterpret controls inside this
  // boundary as source-caret clicks before their click/double-click can fire.
  boundary.dataset.markdaInteractive = 'true';
  let listeningForOutsidePointer = false;
  let renderedOccupiedHeight = 0;
  const blockSourceEditor = input instanceof HTMLTextAreaElement
    && input.classList.contains('markda-block-source-editor') ? input : undefined;
  const resizeBlockSourceEditor = () => {
    if (!blockSourceEditor || blockSourceEditor.hidden) return;
    // Chromium keeps textarea.scrollHeight at its native two-row minimum even
    // when rows=1. A short-lived mirror gives us the actual wrapped source
    // height, including trailing blank lines, without that artificial floor.
    const styles = getComputedStyle(blockSourceEditor);
    const mirror = document.createElement('div');
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.boxSizing = 'border-box';
    mirror.style.width = `${blockSourceEditor.getBoundingClientRect().width}px`;
    mirror.style.padding = styles.padding;
    mirror.style.border = styles.border;
    mirror.style.font = styles.font;
    mirror.style.lineHeight = styles.lineHeight;
    mirror.style.letterSpacing = styles.letterSpacing;
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.tabSize = styles.tabSize;
    mirror.textContent = `${blockSourceEditor.value}\u200b`;
    document.body.append(mirror);
    const sourceHeight = mirror.getBoundingClientRect().height;
    mirror.remove();
    const height = `${Math.ceil(Math.max(renderedOccupiedHeight, sourceHeight))}px`;
    blockSourceEditor.style.height = height;
    blockSourceEditor.style.maxHeight = height;
    editor.requestMeasure();
  };
  const stopListeningForOutsidePointer = () => {
    if (!listeningForOutsidePointer) return;
    document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    listeningForOutsidePointer = false;
  };
  const close = () => {
    if (input.hidden) return;
    input.hidden = true;
    rendered.hidden = false;
    boundary.style.minHeight = '';
    stopListeningForOutsidePointer();
    const active = document.activeElement;
    if (active instanceof HTMLElement && input.contains(active)) active.blur();
    editor.requestMeasure();
  };
  function closeOnOutsidePointer(event: PointerEvent): void {
    if (event.target instanceof Node && !boundary.contains(event.target)) close();
  }
  const closeAfterFocusLeaves = () => queueMicrotask(() => {
    if (!boundary.contains(document.activeElement)) close();
  });
  boundary.addEventListener('focusout', closeAfterFocusLeaves);
  blockSourceEditor?.addEventListener('input', resizeBlockSourceEditor);
  const toggle = () => {
    if (!input.hidden) {
      close();
      return;
    }
    // Preserve the complete block footprint while swapping the rendered
    // content for its source editor. In particular, KaTeX's display margin is
    // part of the wrapper's height (the math wrapper is a flow root), so the
    // following document blocks remain at exactly the same vertical position.
    renderedOccupiedHeight = boundary.getBoundingClientRect().height;
    boundary.style.minHeight = `${Math.ceil(renderedOccupiedHeight)}px`;
    input.hidden = false;
    rendered.hidden = true;
    resizeBlockSourceEditor();
    const focusTarget = input.matches('input,textarea,select,[contenteditable="true"]')
      ? input
      : input.querySelector<HTMLElement>('input,textarea,select,[contenteditable="true"]');
    focusTarget?.focus();
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    listeningForOutsidePointer = true;
    editor.requestMeasure();
  };
  const dispose = () => {
    stopListeningForOutsidePointer();
    boundary.removeEventListener('focusout', closeAfterFocusLeaves);
    blockSourceEditor?.removeEventListener('input', resizeBlockSourceEditor);
  };
  return { toggle, dispose };
}

let livePreviewPointerGeneration = 0;

function browserPositionAtPointer(event: MouseEvent, editor: EditorView): number | null {
  const ownerDocument = editor.dom.ownerDocument;
  const modern = ownerDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (modern) {
    try { return editor.posAtDOM(modern.offsetNode, modern.offset); } catch { return null; }
  }
  const legacy = (ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  }).caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!legacy) return null;
  try { return editor.posAtDOM(legacy.startContainer, legacy.startOffset); } catch { return null; }
}

function syncNativeSelection(editor: EditorView): void {
  if (!editor.hasFocus) return;
  const main = editor.state.selection.main;
  const anchor = editor.domAtPos(main.anchor);
  const head = editor.domAtPos(main.head);
  const selection = editor.dom.ownerDocument.getSelection();
  if (!selection) return;
  selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
}

function beginLivePreviewPointer(event: MouseEvent, editor: EditorView): boolean {
  if (event.detail > 1 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
  const anchor = browserPositionAtPointer(event, editor);
  const ownerWindow = editor.dom.ownerDocument.defaultView;
  if (anchor === null || !ownerWindow) return false;

  const generation = ++livePreviewPointerGeneration;
  const documentAtStart = editor.state.doc;
  let dragged = false;
  event.preventDefault();
  beginLivePreviewFreeze?.(editor);
  editor.contentDOM.focus({ preventScroll: true });
  editor.dispatch({ selection: EditorSelection.cursor(anchor), userEvent: 'select.pointer' });
  syncNativeSelection(editor);

  const move = (moveEvent: MouseEvent) => {
    if (generation !== livePreviewPointerGeneration || editor.state.doc !== documentAtStart || moveEvent.buttons === 0) return;
    if (!dragged && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) <= 3) return;
    dragged = true;
    const head = browserPositionAtPointer(moveEvent, editor);
    if (head === null || head === editor.state.selection.main.head) return;
    moveEvent.preventDefault();
    editor.dispatch({ selection: EditorSelection.range(anchor, head), userEvent: 'select.pointer' });
    syncNativeSelection(editor);
  };
  const finish = (finishEvent: Event) => {
    ownerWindow.removeEventListener('mousemove', move, true);
    ownerWindow.removeEventListener('mouseup', finish, true);
    ownerWindow.removeEventListener('pointercancel', finish, true);
    ownerWindow.removeEventListener('blur', finish, true);
    queueMicrotask(() => {
      if (generation !== livePreviewPointerGeneration || !editor.dom.isConnected) return;
      if (dragged && finishEvent.type === 'mouseup' && finishEvent instanceof MouseEvent && editor.state.doc === documentAtStart) {
        const head = browserPositionAtPointer(finishEvent, editor);
        if (head !== null && head !== editor.state.selection.main.head) {
          editor.dispatch({ selection: EditorSelection.range(anchor, head), userEvent: 'select.pointer' });
        }
      }
      syncNativeSelection(editor);
      ownerWindow.requestAnimationFrame(() => {
        if (generation !== livePreviewPointerGeneration || !editor.dom.isConnected) return;
        editor.dispatch({ effects: settleLivePreview.of(generation) });
        ownerWindow.requestAnimationFrame(() => {
          if (generation !== livePreviewPointerGeneration || !editor.dom.isConnected) return;
          // Settling can reveal Markdown markers and change line geometry without
          // changing the logical selection. CodeMirror's drawn selection layer
          // only refreshes for selection/viewport updates, so explicitly set the
          // unchanged selection after the new geometry has been measured. This
          // removes stale rectangles that otherwise make a two-line drag appear
          // to select both the old and the new line positions.
          editor.dispatch({ selection: editor.state.selection });
          syncNativeSelection(editor);
        });
      });
    });
  };
  ownerWindow.addEventListener('mousemove', move, true);
  ownerWindow.addEventListener('mouseup', finish, true);
  ownerWindow.addEventListener('pointercancel', finish, true);
  ownerWindow.addEventListener('blur', finish, true);
  return true;
}

function createLivePreviewPlugin() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private pointerActive = false;
    private applyingBlockRefresh = false;
    private blockRefreshQueued = false;
    constructor(editor: EditorView) {
      // Widget classes are declared later in this module and are still in their
      // temporal dead zone while EditorView itself is being constructed. Build
      // after module evaluation completes; otherwise CodeMirror catches the
      // ReferenceError and permanently disables the whole live-preview plugin.
      this.decorations = Decoration.none;
      beginLivePreviewFreeze = (target) => {
        if (target === editor) this.pointerActive = true;
      };
    }
    update(update: ViewUpdate): void {
      let modeChanged = false;
      let refreshRequested = false;
      let inlineRefreshRequested = false;
      let settleRequested = false;
      // A view update may contain several transactions. Classify their effects
      // in one pass instead of rescanning every effect for each refresh kind.
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(setMode)) modeChanged = true;
          else if (effect.is(refreshLivePreview)) refreshRequested = true;
          else if (effect.is(refreshInlinePreview)) inlineRefreshRequested = true;
          else if (effect.is(settleLivePreview)) settleRequested = true;
        }
      }
      if (settleRequested) this.pointerActive = false;

      // Keep the exact DOM geometry that CodeMirror used for its pointer hit-test
      // until the gesture has ended. Document edits are mapped through the frozen
      // set, so composition and externally delivered changes cannot leave stale
      // ranges behind.
      if (this.pointerActive && !settleRequested) {
        if (update.docChanged) this.decorations = this.decorations.map(update.changes);
      } else if (update.docChanged || update.viewportChanged || modeChanged || refreshRequested || inlineRefreshRequested
        || settleRequested || update.selectionSet) {
        this.decorations = buildInlineDecorations(update.view);
      }

      // Block widget contents do not depend on the outer selection. CodeMirror
      // still needs a refresh when the caret enters or leaves a replaceable
      // block, but ordinary paragraph cursor movement must stay on the cheap path.
      // A pointer gesture freezes decorations while its selection changes, so its
      // settle transaction must always rebuild: by then startState no longer
      // contains the line the pointer left and cannot identify that block itself.
      if ((update.docChanged || modeChanged || refreshRequested || settleRequested
        || (update.selectionSet && !this.pointerActive && selectionTouchesBlockCandidate(update)))
        && !this.applyingBlockRefresh && !this.blockRefreshQueued) {
        this.blockRefreshQueued = true;
        queueMicrotask(() => {
          this.blockRefreshQueued = false;
          if (!update.view.dom.isConnected) return;
          this.applyingBlockRefresh = true;
          try {
            update.view.dispatch({
              effects: [
                setBlockDecorations.of(buildBlockDecorations(update.view)),
                ...(update.docChanged || modeChanged || refreshRequested
                  ? [setSoftBreakDecorations.of(buildSoftBreakDecorations(update.view))]
                  : []),
              ],
            });
            update.view.requestMeasure();
          } finally {
            this.applyingBlockRefresh = false;
          }
        });
      }
    }
  }, { decorations: (plugin) => plugin.decorations });
}

function selectionTouchesBlockCandidate(update: ViewUpdate): boolean {
  const before = update.startState.doc.lineAt(update.startState.selection.main.head);
  const after = update.state.doc.lineAt(update.state.selection.main.head);
  return isBlockCandidateLine(before.text) || isBlockCandidateLine(after.text)
    || isBlankLineNextToThematicBreak(update.startState, before.number)
    || isBlankLineNextToThematicBreak(update.state, after.number);
}

function isBlockCandidateLine(line: string): boolean {
  return line.includes('|') || /^\s*(?:```|~~~|\$\$\s*$|(?:[*_-]\s*){3,}|=+\s*$|!\[[^\]]*\]\([^)]+\)\s*$|>\s*(?:\[!|\*\*))/u.test(line);
}

function isThematicBreakLine(state: EditorState, lineNumber: number): boolean {
  const text = state.doc.line(lineNumber).text;
  return /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u.test(text)
    && !(lineNumber > 1 && state.doc.line(lineNumber - 1).text.trim()
      && /^[ \t]{0,3}-+[ \t]*$/u.test(text));
}

function isBlankLineNextToThematicBreak(state: EditorState, lineNumber: number): boolean {
  if (state.doc.line(lineNumber).text.trim()) return false;
  let previous = lineNumber - 1;
  while (previous >= 1 && !state.doc.line(previous).text.trim()) previous--;
  if (previous >= 1 && isThematicBreakLine(state, previous)) return true;
  let next = lineNumber + 1;
  while (next <= state.doc.lines && !state.doc.line(next).text.trim()) next++;
  return next <= state.doc.lines && isThematicBreakLine(state, next);
}

function buildInlineDecorations(editor: EditorView): DecorationSet {
  const state = editor.state.field(modeField);
  const decorations: { from: number; to?: number; decoration: Decoration }[] = [];
  const selection = editor.state.selection.main;
  // A blurred editor keeps its last logical selection. Source markers should be
  // exposed only while that selection still owns the visible editing focus.
  const selectionFrom = livePreviewSelectionFocused ? selection.from : -1;
  const selectionTo = livePreviewSelectionFocused ? selection.to : -1;
  const references = referenceDefinitionsFor(editor.state);
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
      // Typora-style single-line display math (`$$…$$`) is owned by the block
      // decoration pass. Without this guard the inline `$…$` matcher renders the
      // inner pair and leaves one literal dollar sign visible on each side.
      if (/^\s*\$\$(.+)\$\$\s*$/u.test(text)) continue;
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
      const setext = lineNumber < editor.state.doc.lines
        ? editor.state.doc.line(lineNumber + 1).text.match(/^[ \t]{0,3}(=+|-+)[ \t]*$/u)
        : null;
      const setextMarker = lineNumber > 1 && editor.state.doc.line(lineNumber - 1).text.trim()
        ? text.match(/^[ \t]{0,3}(=+|-+)[ \t]*$/u)
        : null;
      const quote = text.match(/^(>[ \t]?)/u);
      const list = text.match(/^(\s*)([-+*]|\d+[.)])(\s+)/u);
      if (heading) decorations.push({ from: line.from, decoration: Decoration.line({ class: `markda-h${heading[1]?.length ?? 1}` }) });
      if (setext && text.trim()) decorations.push({
        from: line.from,
        decoration: Decoration.line({ class: setext[1]?.startsWith('=') ? 'markda-h1' : 'markda-h2' }),
      });
      if (quote) decorations.push({ from: line.from, decoration: Decoration.line({ class: 'markda-quote' }) });
      if (state.focusMode && (lineNumber < focusLines.from || lineNumber > focusLines.to)) decorations.push({ from: line.from, decoration: Decoration.line({ class: 'markda-unfocused' }) });
      if (!state.sourceMode) {
        const task = text.match(/^(\s*[-+*]\s+)\[([ xX])\](\s+)/u);
        if (task) {
          const from = line.from + (task[1]?.length ?? 0);
          const expanded = selectionIntersectsBlock(selectionFrom, selectionTo, line.from, line.to);
          if (!expanded) {
            decorations.push({
              from,
              to: from + 3,
              decoration: Decoration.replace({
                widget: new TaskWidget(editor, from, (task[2] ?? ' ') !== ' '),
              }),
            });
          }
        }
        if (heading) addMetaDecoration(decorations, line.from, line.from + heading[0].length,
          selectionIntersectsBlock(selectionFrom, selectionTo, line.from, line.to));
        if (setextMarker) {
          const headingLine = editor.state.doc.line(lineNumber - 1);
          const expanded = selectionIntersectsBlock(selectionFrom, selectionTo, headingLine.from, line.to);
          decorations.push({
            from: line.from,
            decoration: Decoration.line({ class: expanded ? 'markda-setext-marker-expanded' : 'markda-setext-marker' }),
          });
          addMetaDecoration(decorations, line.from, line.to, expanded);
        }
        if (quote) addMetaDecoration(decorations, line.from, line.from + quote[0].length,
          selectionIntersectsBlock(selectionFrom, selectionTo, line.from, line.to));
        if (list) {
          const markerFrom = line.from + (list[1]?.length ?? 0);
          const markerTo = markerFrom + (list[2]?.length ?? 0);
          const expanded = selectionIntersectsBlock(selectionFrom, selectionTo, line.from, line.to);
          const bullet = /^[-+*]$/u.test(list[2] ?? '');
          decorations.push({
            from: markerFrom,
            to: markerTo,
            decoration: Decoration.mark({
              class: `${bullet ? 'markda-list-bullet-source' : 'markda-list-marker'}${expanded ? ' markda-meta-expanded' : ''}`,
            }),
          });
        }
        if (!/^[ \t]{0,3}\[[^\]\n]+\]:/u.test(text)) {
          addInlineDecorations(decorations, editor, line.from, text, selectionFrom, selectionTo, references);
        }
      } else {
        addSourceLinkDecorations(decorations, line.from, text);
      }
    }
  }
  return Decoration.set(decorations.map((item) => item.decoration.range(item.from, item.to ?? item.from)), true);
}

/**
 * CommonMark treats a single newline inside a paragraph as a space. Replace
 * those source-only soft breaks in live mode so prose hard-wrapped by another
 * editor can use the full available width. Blank lines, hard breaks, and
 * structural block boundaries remain visible.
 */
function buildSoftBreakDecorations(
  editor: EditorView,
): DecorationSet {
  const mode = editor.state.field(modeField);
  if (mode.sourceMode || settings.markdown.breaks) return Decoration.none;
  const decorations: { from: number; to: number; decoration: Decoration }[] = [];
  const doc = editor.state.doc;
  // Iterate parsed paragraphs once instead of resolving two syntax ancestors
  // for every line in the document. This preserves document-wide decorations
  // without recreating the pre-08b1f99 viewport instability.
  syntaxTree(editor.state).iterate({
    enter(node) {
      if (node.name !== 'Paragraph') return;
      // Display-math blocks are implemented outside the Markdown grammar and
      // can otherwise look like an ordinary multi-line paragraph to Lezer.
      if (/^\s*\$\$\s*$/mu.test(editor.state.sliceDoc(node.from, node.to))) return false;
      let line = doc.lineAt(node.from);
      const lastLine = doc.lineAt(Math.max(node.from, node.to - 1)).number;
      while (line.number < lastLine) {
        const next = doc.line(line.number + 1);
        if (line.text.trim() && next.text.trim() && !/(?: {2,}|\\)$/u.test(line.text)) {
          decorations.push({
            from: line.to,
            to: next.from,
            decoration: Decoration.replace({ widget: new SoftBreakWidget() }),
          });
        }
        line = next;
      }
      return false;
    },
  });
  return Decoration.set(decorations.map((item) => item.decoration.range(item.from, item.to)), true);
}

/**
 * Block-level widgets (tables, fenced code blocks, images) for the live preview.
 * Kept separate from `buildInlineDecorations` because these are block decorations,
 * which CodeMirror only accepts from a state field (`blockDecorationsField`), not
 * from a view plugin's `decorations` property.
 */
class SelectableBlockWidget extends WidgetType {
  constructor(
    private readonly inner: WidgetType,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) { super(); }

  toDOM(editor: EditorView): HTMLElement {
    const dom = this.inner.toDOM(editor);
    dom.classList.add('markda-selectable-block');
    dom.dataset.markdaSourceFrom = String(this.sourceFrom);
    dom.dataset.markdaSourceTo = String(this.sourceTo);
    updateBlockSelectionElement(dom, editor.state.selection.main);
    return dom;
  }

  eq(other: SelectableBlockWidget): boolean {
    return this.sourceFrom === other.sourceFrom && this.sourceTo === other.sourceTo
      && this.inner.constructor === other.inner.constructor && this.inner.eq(other.inner);
  }

  get estimatedHeight(): number { return this.inner.estimatedHeight; }
  get lineBreaks(): number { return this.inner.lineBreaks; }
  ignoreEvent(event: Event): boolean { return this.inner.ignoreEvent(event); }
  coordsAt(dom: HTMLElement, pos: number, side: number) { return this.inner.coordsAt(dom, pos, side); }
  destroy(dom: HTMLElement): void { this.inner.destroy(dom); }
}

function createBlockSelectionHighlightPlugin() {
  return ViewPlugin.fromClass(class {
    constructor(editor: EditorView) {
      updateBlockSelectionDOM(editor);
    }

    update(update: ViewUpdate): void {
      if (update.selectionSet || update.docChanged || update.viewportChanged) {
        updateBlockSelectionDOM(update.view);
      }
    }

    docViewUpdate(editor: EditorView): void {
      updateBlockSelectionDOM(editor);
    }
  });
}

function updateBlockSelectionDOM(editor: EditorView): void {
  editor.dom.querySelectorAll<HTMLElement>('.markda-selectable-block').forEach((element) => {
    updateBlockSelectionElement(element, editor.state.selection.main);
  });
}

function updateBlockSelectionElement(element: HTMLElement, selection: EditorSelection['main']): void {
  const from = Number(element.dataset.markdaSourceFrom);
  const to = Number(element.dataset.markdaSourceTo);
  element.classList.toggle(
    'markda-block-selection',
    !selection.empty && Number.isInteger(from) && Number.isInteger(to)
      && from < selection.to && to > selection.from,
  );
}

function buildBlockDecorations(editor: EditorView): DecorationSet {
  const decorations: { from: number; to?: number; decoration: Decoration }[] = [];
  const collapsedBlankLineStarts = new Set<number>();
  const state = editor.state.field(modeField);
  const selection = editor.state.selection.main;
  const selectionFrom = livePreviewSelectionFocused ? selection.from : -1;
  const selectionTo = livePreviewSelectionFocused ? selection.to : -1;
  let documentSource: string | undefined;
  if (state.sourceMode) return Decoration.none;
  let processedUntil = -1;
  // Block replacements change the editor's height map. If the decoration set is
  // rebuilt from visibleRanges, that re-layout can move a block outside the next
  // reported viewport and remove it again. The resulting feedback loop exposes
  // raw tables, images, fences, and math after scrolling or window re-layout.
  // Keep one document-wide source of truth; CodeMirror still creates widget DOM
  // lazily only when a decorated block enters the viewport.
  const firstLine = 1;
  const lastLine = editor.state.doc.lines;
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
      const line = editor.state.doc.line(lineNumber);
      if (line.from < processedUntil) continue;
      processedUntil = line.to + 1;
      const text = line.text;
      if (!isBlockDecorationCandidate(text)) continue;
      if (lineNumber === 1 && /^---\s*$/u.test(text)) {
        let endLine = 2;
        while (endLine <= editor.state.doc.lines && !/^(?:---|\.\.\.)\s*$/u.test(editor.state.doc.line(endLine).text)) endLine++;
        if (endLine <= editor.state.doc.lines) {
          const closing = editor.state.doc.line(endLine);
          const content = codeContentRange(editor.state, line.to, closing.from);
          const to = closing.to;
          decorations.push({
            from: line.from,
            to: blockDecorationTo(editor.state, to),
            decoration: Decoration.replace({
              widget: new FrontMatterWidget(editor, line.from, to, editor.state.sliceDoc(content.from, content.to)),
              block: true,
            }),
          });
          processedUntil = to + 1;
          continue;
        }
      }
      if (/^\s*\[toc\]\s*$/iu.test(text)) {
        decorations.push({
          from: line.from,
          to: blockDecorationTo(editor.state, line.to),
          decoration: Decoration.replace({ widget: new TocWidget(editor, line.from), block: true }),
        });
        continue;
      }
      const htmlBlock = settings.markdown.html && /^\s*</u.test(text)
        ? findHtmlBlock(editor.state, lineNumber)
        : undefined;
      if (htmlBlock && editor.state.doc.lineAt(htmlBlock.from).number === lineNumber) {
        const endLine = editor.state.doc.lineAt(Math.max(htmlBlock.from, htmlBlock.to - 1));
        decorations.push({
          from: htmlBlock.from,
          to: blockDecorationTo(editor.state, endLine.to),
          decoration: Decoration.replace({
            widget: new HtmlBlockWidget(
              editor,
              htmlBlock.from,
              editor.state.sliceDoc(htmlBlock.from, htmlBlock.to),
              settings.security.allowUnsafeHtml,
            ),
            block: true,
          }),
        });
        processedUntil = endLine.to + 1;
        continue;
      }
      const indentedCode = /^(?: {4}|\t)/u.test(text)
        ? findSyntaxAncestor(editor.state, Math.min(line.from + Math.min(4, line.length), line.to), 'CodeBlock')
        : undefined;
      if (indentedCode && editor.state.doc.lineAt(indentedCode.from).number === lineNumber) {
        const endLine = editor.state.doc.lineAt(Math.max(indentedCode.from, indentedCode.to - 1));
        const source = editor.state.sliceDoc(indentedCode.from, indentedCode.to)
          .replace(/^(?: {4}|\t)/gmu, '')
          .replace(/\r?\n$/u, '');
        decorations.push({
          from: line.from,
          to: blockDecorationTo(editor.state, endLine.to),
          decoration: Decoration.replace({
            widget: new IndentedCodeWidget(editor, line.from, source),
            block: true,
          }),
        });
        processedUntil = endLine.to + 1;
        continue;
      }
      const footnoteDefinition = text.match(/^[ \t]{0,3}\[\^([^\]\n]+)\]:[ \t]*(.*)$/u);
      if (footnoteDefinition) {
        let endLine = lineNumber;
        const contentLines = [footnoteDefinition[2] ?? ''];
        while (endLine < editor.state.doc.lines) {
          const continuation = editor.state.doc.line(endLine + 1).text.match(/^(?: {4}|\t)(.*)$/u);
          if (!continuation) break;
          endLine++;
          contentLines.push(continuation[1] ?? '');
        }
        const end = editor.state.doc.line(endLine).to;
        decorations.push({
          from: line.from,
          to: blockDecorationTo(editor.state, end),
          decoration: Decoration.replace({
            widget: new FootnoteDefinitionWidget(
              editor, line.from, footnoteDefinition[1] ?? '', contentLines.join('\n'),
            ),
            block: true,
          }),
        });
        processedUntil = end + 1;
        continue;
      }
      const referenceDefinition = parseReferenceDefinition(text);
      if (referenceDefinition) {
        decorations.push({
          from: line.from,
          to: blockDecorationTo(editor.state, line.to),
          decoration: Decoration.replace({
            widget: new ReferenceDefinitionWidget(editor, line.from, referenceDefinition.label, referenceDefinition),
            block: true,
          }),
        });
        continue;
      }
      const thematicBreak = isThematicBreakLine(editor.state, lineNumber);
      if (thematicBreak) {
        if (!selectionIntersectsBlock(selectionFrom, selectionTo, line.from, line.to)) {
          decorations.push({
            from: line.from,
            to: blockDecorationTo(editor.state, line.to),
            decoration: Decoration.replace({ widget: new ThematicBreakWidget(editor, line.from), block: true }),
          });
          for (const direction of [-1, 1] as const) {
            for (let blankLineNumber = lineNumber + direction;
              blankLineNumber >= 1 && blankLineNumber <= editor.state.doc.lines;
              blankLineNumber += direction) {
              const blankLine = editor.state.doc.line(blankLineNumber);
              if (blankLine.text.trim()) break;
              if (selectionIntersectsBlock(selectionFrom, selectionTo, blankLine.from, blankLine.to)
                || collapsedBlankLineStarts.has(blankLine.from)) continue;
              collapsedBlankLineStarts.add(blankLine.from);
              decorations.push({
                from: blankLine.from,
                decoration: Decoration.line({ class: 'markda-thematic-blank-line' }),
              });
            }
          }
        }
        continue;
      }
      const inlineBlockMath = text.match(/^\s*\$\$(.+)\$\$\s*$/u);
      if (inlineBlockMath) {
        decorations.push({
          from: line.from,
          to: blockDecorationTo(editor.state, line.to),
          decoration: Decoration.replace({
            widget: new MathWidget(inlineBlockMath[1] ?? '', true, editor, line.from),
            block: true,
          }),
        });
        processedUntil = line.to + 1;
        continue;
      }
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
          const closingLine = editor.state.doc.line(endLine);
          const contentRange = codeContentRange(editor.state, line.to, closingLine.from);
          const source = editor.state.sliceDoc(contentRange.from, contentRange.to);
          decorations.push({ from, to: blockDecorationTo(editor.state, to), decoration: Decoration.replace({ widget: new MathWidget(source, true, editor, from), block: true }) });
          processedUntil = to + 1;
          continue;
        }
      }
      const table = text.includes('|') ? findMarkdownTable(documentSource ??= editor.state.doc.toString(), line.from, lineNumber - 1) : undefined;
      if (table) {
        decorations.push({ from: table.from, to: blockDecorationTo(editor.state, table.to), decoration: Decoration.replace({ widget: new TableWidget(editor, table), block: true }) });
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
        const contentRange = codeContentRange(editor.state, line.to, editor.state.doc.line(endLine).from);
        const contentFrom = contentRange.from;
        const contentTo = contentRange.to;
        decorations.push({ from: line.from, to: blockDecorationTo(editor.state, end), decoration: Decoration.replace({ widget: new CodeBlockWidget(editor, line.from, editor.state.sliceDoc(contentFrom, Math.max(contentFrom, contentTo)), fence[2] ?? ''), block: true }) });
        // Even while this block is exposed as source, its closing fence belongs
        // to the opening fence above. Without skipping the full range here, the
        // closing fence is parsed again as a new opener and can absorb every
        // ordinary paragraph that follows into a giant code widget.
        processedUntil = end + 1;
        continue;
      }
      const image = text.match(/^\s*!\[([^\]]*)\]\((<[^>]+>|(?:\\.|[^\s)])+)(?:\s+["']([^"']*)["'])?\)\s*$/u);
      if (image) {
        const source = (image[2] ?? '').replace(/^<|>$/gu, '');
        decorations.push({ from: line.from, to: blockDecorationTo(editor.state, line.to), decoration: Decoration.replace({ widget: new ImageWidget(editor, line.from, image[1] ?? '', source, image[3] ?? ''), block: true }) });
      }
      // GitHub Alert (Callout), with the older bold-label form retained for compatibility.
      const calloutMatch = text.match(/^>\s*(?:\[!(Note|Tip|Important|Warning|Caution)\]|\*\*(Note|Tip|Important|Warning|Caution)\*\*)\s*$/iu);
      if (calloutMatch) {
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
        decorations.push({ from: line.from, to: blockDecorationTo(editor.state, end), decoration: Decoration.replace({ widget: new CalloutWidget(editor, line.from, calloutType, content), block: true }) });
        processedUntil = end;
        continue;
      }
  }
  if (decorations.some((item) => item.to === editor.state.doc.length)) {
    decorations.push({
      from: editor.state.doc.length,
      decoration: Decoration.widget({
        widget: new TrailingParagraphWidget(editor),
        block: true,
        side: 1,
      }),
    });
  }
  if (decorations.length === 0) return Decoration.none;
  return Decoration.set(decorations.map((item) => {
    const to = item.to ?? item.from;
    return selectableBlockDecoration(editor, item.from, to, item.decoration).range(item.from, to);
  }), true);
}

function selectableBlockDecoration(
  editor: EditorView,
  from: number,
  to: number,
  decoration: Decoration,
): Decoration {
  if (!decoration.spec.block || !decoration.spec.widget || to <= from) return decoration;
  // Block replacements include the following line break for layout. Selecting
  // only that character does not select the rendered object.
  const sourceTo = editor.state.sliceDoc(to - 1, to) === '\n' ? to - 1 : to;
  return Decoration.replace({
    ...decoration.spec,
    widget: new SelectableBlockWidget(decoration.spec.widget as WidgetType, from, sourceTo),
  });
}

function isBlockDecorationCandidate(line: string): boolean {
  if (line.includes('|') || line.startsWith('    ') || line.startsWith('\t')) return true;
  const first = line.trimStart().charCodeAt(0);
  return first === 0x21 || first === 0x24 || first === 0x3c || first === 0x3e
    || first === 0x5b || first === 0x5f || first === 0x60 || first === 0x7e
    || first === 0x2a || first === 0x2d;
}

/**
 * Inline spans expand only while the caret is strictly inside their source
 * range. A caret at the rendered right edge belongs to the surrounding text,
 * matching Typora's "move the cursor to the middle of a span" behavior.
 */
function selectionIntersects(selectionFrom: number, selectionTo: number, from: number, to: number): boolean {
  return selectionFrom === selectionTo
    ? selectionFrom > from && selectionFrom < to
    : selectionTo > from && selectionFrom < to;
}

/**
 * Block syntax is controlled by focus of the whole source block, not by whether
 * the caret is strictly inside its text. The start and end positions therefore
 * remain active; moving to another line (or blurring the editor) closes it.
 */
function selectionIntersectsBlock(
  selectionFrom: number, selectionTo: number, from: number, to: number,
): boolean {
  if (selectionFrom < 0 || selectionTo < 0) return false;
  return selectionFrom === selectionTo
    ? selectionFrom >= from && selectionFrom <= to
    : selectionTo >= from && selectionFrom <= to;
}

function blockDecorationTo(state: EditorState, sourceTo: number): number {
  if (sourceTo >= state.doc.length) return sourceTo;
  const line = state.doc.lineAt(sourceTo);
  return line.to === sourceTo && line.number < state.doc.lines ? state.doc.line(line.number + 1).from : sourceTo;
}

function findSyntaxAncestor(
  state: EditorState, position: number, name: string,
): { from: number; to: number } | undefined {
  let node = syntaxTree(state).resolveInner(position, 1);
  for (;;) {
    if (node.name === name) return { from: node.from, to: node.to };
    if (!node.parent) return undefined;
    node = node.parent;
  }
}

function findHtmlBlock(state: EditorState, openingLineNumber: number): { from: number; to: number } | undefined {
  const openingLine = state.doc.line(openingLineNumber);
  const openingTag = openingLine.text.match(/^\s*<([A-Za-z][\w-]*)\b[^>]*>/u)?.[1];
  if (openingTag
    && /^(?:address|article|aside|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/iu.test(openingTag)
    && !/\/>\s*$/u.test(openingLine.text)
    && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/iu.test(openingTag)) {
    const closingTag = new RegExp(`</${openingTag}\\s*>`, 'iu');
    for (let lineNumber = openingLineNumber; lineNumber <= state.doc.lines; lineNumber++) {
      const line = state.doc.line(lineNumber);
      if (closingTag.test(line.text)) return { from: openingLine.from, to: line.to };
      if (lineNumber > openingLineNumber && !line.text.trim()) break;
    }
  }
  const position = Math.min(openingLine.from + openingLine.text.search(/\S/u), openingLine.to);
  return findSyntaxAncestor(state, position, 'HTMLBlock');
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
  references: ReadonlyMap<string, MarkdownReferenceDefinition>,
): void {
  const linkRanges: { start: number; end: number }[] = [];
  if (settings.markdown.html) {
    for (const match of text.matchAll(/<([A-Za-z][\w-]*)(?:\s[^<>]*?)?>[\s\S]*?<\/\1>/gu)) {
      const start = lineFrom + (match.index ?? 0);
      const end = start + match[0].length;
      const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
      linkRanges.push({ start, end });
      if (!expanded) {
        output.push({
          from: start,
          to: end,
          decoration: Decoration.replace({ widget: new InlineHtmlWidget(editor, start, match[0]) }),
        });
      }
    }
  }
  for (const match of text.matchAll(/&(?:#(?:x[0-9a-f]+|\d+)|[A-Za-z][A-Za-z0-9]+);/giu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    linkRanges.push({ start, end });
    if (!expanded) {
      output.push({
        from: start,
        to: end,
        decoration: Decoration.replace({ widget: new EntityWidget(editor, start, match[0]) }),
      });
    }
  }
  for (const match of text.matchAll(/!\[([^\]\n]*)\]\(([^)\n]+)\)/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    linkRanges.push({ start, end });
    // A stand-alone image is owned by the richer block ImageWidget.
    if (text.trim() === match[0]) continue;
    const rawTarget = (match[2] ?? '').trim();
    const source = rawTarget.match(/^<([^>]+)>/u)?.[1] ?? rawTarget.match(/^\S+/u)?.[0] ?? rawTarget;
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    if (expanded) {
      addMetaDecoration(output, start, start + 2, true);
      output.push({
        from: start + 2,
        to: start + 2 + (match[1]?.length ?? 0),
        decoration: Decoration.mark({ class: 'markda-image-alt' }),
      });
      addMetaDecoration(output, start + 2 + (match[1]?.length ?? 0), end, true);
    } else {
      output.push({
        from: start,
        to: end,
        decoration: Decoration.replace({ widget: new InlineImageWidget(editor, start, match[1] ?? '', source) }),
      });
    }
  }
  for (const match of text.matchAll(/!\[([^\]\n]*)\]\[([^\]\n]*)\]/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const definition = references.get(normalizeReferenceLabel(match[2] || match[1] || ''));
    if (!definition) continue;
    linkRanges.push({ start, end });
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    if (expanded) {
      addMetaDecoration(output, start, start + 2, true);
      output.push({
        from: start + 2,
        to: start + 2 + (match[1]?.length ?? 0),
        decoration: Decoration.mark({ class: 'markda-image-alt' }),
      });
      addMetaDecoration(output, start + 2 + (match[1]?.length ?? 0), end, true);
    } else {
      output.push({
        from: start,
        to: end,
        decoration: Decoration.replace({
          widget: new InlineImageWidget(editor, start, match[1] ?? '', definition.destination),
        }),
      });
    }
  }
  for (const match of text.matchAll(/!\[([^\]\n]+)\](?![\[(])/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const definition = references.get(normalizeReferenceLabel(match[1] ?? ''));
    if (!definition) continue;
    linkRanges.push({ start, end });
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    if (expanded) {
      addMetaDecoration(output, start, start + 2, true);
      output.push({
        from: start + 2,
        to: end - 1,
        decoration: Decoration.mark({ class: 'markda-image-alt' }),
      });
      addMetaDecoration(output, end - 1, end, true);
    } else {
      output.push({
        from: start,
        to: end,
        decoration: Decoration.replace({
          widget: new InlineImageWidget(editor, start, match[1] ?? '', definition.destination),
        }),
      });
    }
  }
  for (const match of text.matchAll(/\[\^([^\]\n]+)\]/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    linkRanges.push({ start, end });
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    if (expanded) {
      addMetaDecoration(output, start, start + 2, true);
      output.push({
        from: start + 2,
        to: end - 1,
        decoration: Decoration.mark({ class: 'markda-footnote-source' }),
      });
      addMetaDecoration(output, end - 1, end, true);
    } else {
      output.push({
        from: start,
        to: end,
        decoration: Decoration.replace({ widget: new FootnoteReferenceWidget(editor, start, match[1] ?? '') }),
      });
    }
  }
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if ((match.index ?? 0) > 0 && text[(match.index ?? 0) - 1] === '!') continue;
    const rawHref = (match[2] ?? '').trim();
    const href = rawHref.match(/^<([^>]+)>/u)?.[1] ?? rawHref.match(/^\S+/u)?.[0] ?? rawHref;
    linkRanges.push({ start, end });
    const labelFrom = start + 1;
    const labelTo = labelFrom + (match[1]?.length ?? 0);
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    addMetaDecoration(output, start, labelFrom, expanded);
    output.push({
      from: labelFrom,
      to: labelTo,
      decoration: Decoration.mark({
        class: 'markda-link-text',
        attributes: {
          'data-href': href,
          title: t('editOrOpenLink'),
        },
      }),
    });
    addMetaDecoration(output, labelTo, end, expanded);
  }
  for (const match of text.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if ((match.index ?? 0) > 0 && text[(match.index ?? 0) - 1] === '!') continue;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const definition = references.get(normalizeReferenceLabel(match[2] || match[1] || ''));
    if (!definition) continue;
    linkRanges.push({ start, end });
    const labelFrom = start + 1;
    const labelTo = labelFrom + (match[1]?.length ?? 0);
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    addMetaDecoration(output, start, labelFrom, expanded);
    output.push({
      from: labelFrom,
      to: labelTo,
      decoration: Decoration.mark({
        class: 'markda-link-text',
        attributes: {
          'data-href': definition.destination,
          title: definition.title || 'Click to edit; Ctrl/Cmd+click to open',
        },
      }),
    });
    addMetaDecoration(output, labelTo, end, expanded);
  }
  for (const match of text.matchAll(/(?<!!)\[([^\]\n^][^\]\n]*)\](?![\[(])/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const definition = references.get(normalizeReferenceLabel(match[1] ?? ''));
    if (!definition) continue;
    linkRanges.push({ start, end });
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    addMetaDecoration(output, start, start + 1, expanded);
    output.push({
      from: start + 1,
      to: end - 1,
      decoration: Decoration.mark({
        class: 'markda-link-text',
        attributes: {
          'data-href': definition.destination,
          title: definition.title || 'Click to edit; Ctrl/Cmd+click to open',
        },
      }),
    });
    addMetaDecoration(output, end - 1, end, expanded);
  }
  for (const match of text.matchAll(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/giu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    const href = match[1] ?? '';
    linkRanges.push({ start, end });
    addMetaDecoration(output, start, start + 1, expanded);
    output.push({
      from: start + 1,
      to: end - 1,
      decoration: Decoration.mark({
        class: 'markda-link-text',
        attributes: {
          'data-href': href,
          title: t('editOrOpenLink'),
        },
      }),
    });
    addMetaDecoration(output, end - 1, end, expanded);
  }
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()]+/giu)) {
    const raw = match[0].replace(/[.,!?;:]+$/u, '');
    const start = lineFrom + (match.index ?? 0);
    const end = start + raw.length;
    if (!raw || linkRanges.some((range) => start < range.end && end > range.start)) continue;
    linkRanges.push({ start, end });
    output.push({
      from: start,
      to: end,
      decoration: Decoration.mark({
        class: 'markda-link-text',
        attributes: { 'data-href': raw, title: t('openLinkHint') },
      }),
    });
  }
  for (const match of text.matchAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    addMetaDecoration(output, start, start + 1, expanded);
    linkRanges.push({ start, end });
  }
  for (const match of text.matchAll(/(?<![\w:]):([a-z0-9_+-]+):(?![\w:])/giu)) {
    const name = (match[1] ?? '').toLocaleLowerCase();
    const value = emojiNames[name];
    if (!value) continue;
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    linkRanges.push({ start, end });
    if (!selectionIntersects(selectionFrom, selectionTo, start, end)) {
      output.push({
        from: start,
        to: end,
        decoration: Decoration.replace({ widget: new EmojiWidget(value, name) }),
      });
    }
  }
  const patterns: readonly [RegExp, string, number][] = [
    [/(\*\*|__)(?=\S)(.+?\S)\1/gu, 'markda-strong', 2],
    [/(?<!\*)\*(?!\*)(?=\S)(.+?\S)(?<!\*)\*(?!\*)/gu, 'markda-emphasis', 1],
    [/(?<![\w_])_(?!_)(?=\S)(.+?\S)_(?![\w_])/gu, 'markda-emphasis', 1],
    [/~~(?=\S)(.+?\S)~~/gu, 'markda-strike', 2],
    [/(?<!~)~(?!~)(?=\S)([^~\s](?:[^~]*?[^~\s])?)~(?!~)/gu, 'markda-subscript', 1],
    [/\^(?=\S)([^^\s](?:[^^]*?[^^\s])?)\^/gu, 'markda-superscript', 1],
    [/==(?=\S)(.+?\S)==/gu, 'markda-highlight', 2],
    [/`([^`]+)`/gu, 'markda-code', 1],
  ];
  for (const [pattern, className, markerLength] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = lineFrom + (match.index ?? 0);
      const end = start + match[0].length;
      if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
      const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
      addMetaDecoration(output, start, start + markerLength, expanded);
      addMetaDecoration(output, end - markerLength, end, expanded);
      output.push({ from: start + markerLength, to: end - markerLength, decoration: Decoration.mark({ class: className }) });
    }
  }
  for (const match of text.matchAll(/\$([^$\n]+)\$/gu)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (linkRanges.some((range) => start < range.end && end > range.start)) continue;
    const expanded = selectionIntersects(selectionFrom, selectionTo, start, end);
    if (expanded) {
      // Keep the source positions stable while the user edits the expression.
      // Once the selection leaves the range, rebuild this as the KaTeX widget
      // below so live preview returns to its WYSIWYG representation.
      addMetaDecoration(output, start, start + 1, true);
      output.push({ from: start + 1, to: end - 1, decoration: Decoration.mark({ class: 'markda-inline-math-source' }) });
      addMetaDecoration(output, end - 1, end, true);
    } else {
      output.push({ from: start, to: end, decoration: Decoration.replace({
        widget: new MathWidget(match[1] ?? '', false, editor, start),
      }) });
    }
  }
  const hardBreak = text.match(/ {2,}$/u);
  if (hardBreak) {
    const start = lineFrom + text.length - hardBreak[0].length;
    addMetaDecoration(output, start, lineFrom + text.length,
      selectionIntersects(selectionFrom, selectionTo, start, lineFrom + text.length));
  }
}

interface MarkdownReferenceDefinition {
  destination: string;
  title?: string;
}

interface ParsedReferenceDefinition extends MarkdownReferenceDefinition {
  label: string;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function decodeHtmlEntity(source: string): string {
  return decodeHTML(source);
}

function commitHtmlBlock(editor: EditorView, from: number, html: string): void {
  const block = findSyntaxAncestor(editor.state, Math.min(from, editor.state.doc.length), 'HTMLBlock');
  if (!block) return;
  const safeHtml = sanitizeEditableHtmlSource(html);
  if (editor.state.sliceDoc(block.from, block.to) !== safeHtml) {
    editor.dispatch({ changes: { from: block.from, to: block.to, insert: safeHtml } });
  }
}

function parseReferenceDefinition(line: string): ParsedReferenceDefinition | undefined {
  const match = line.match(/^[ \t]{0,3}\[([^\]\n^][^\]\n]*)\]:[ \t]*(?:<([^>\n]+)>|(\S+?))(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?[ \t]*$/u);
  if (!match) return undefined;
  const label = match[1] ?? '';
  const destination = match[2] ?? match[3] ?? '';
  const title = match[4] ?? match[5] ?? match[6];
  return label && destination ? { label, destination, ...(title ? { title } : {}) } : undefined;
}

function collectReferenceDefinitions(source: string): ReadonlyMap<string, MarkdownReferenceDefinition> {
  const definitions = new Map<string, MarkdownReferenceDefinition>();
  for (const line of source.split(/\r\n|\r|\n/u)) {
    const parsed = parseReferenceDefinition(line);
    if (!parsed) continue;
    const label = normalizeReferenceLabel(parsed.label);
    if (!definitions.has(label)) {
      definitions.set(label, { destination: parsed.destination, ...(parsed.title ? { title: parsed.title } : {}) });
    }
  }
  return definitions;
}

function referenceDefinitionsFor(state: EditorState): ReadonlyMap<string, MarkdownReferenceDefinition> {
  if (referenceDefinitionCache?.doc === state.doc) return referenceDefinitionCache.definitions;
  const definitions = collectReferenceDefinitions(state.doc.toString());
  referenceDefinitionCache = { doc: state.doc, definitions };
  return definitions;
}

function commitFootnoteDefinition(editor: EditorView, from: number, label: string, content: string): void {
  const opening = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  if (!/^[ \t]{0,3}\[\^[^\]\n]+\]:/u.test(opening.text)) return;
  let endLine = opening.number;
  while (endLine < editor.state.doc.lines && /^(?: {4}|\t)/u.test(editor.state.doc.line(endLine + 1).text)) endLine++;
  const to = editor.state.doc.line(endLine).to;
  const eol = editor.state.doc.toString().match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  const safeLabel = label.replace(/[\]\r\n]/gu, '');
  const replacement = `[^${safeLabel}]: ${lines[0] ?? ''}${lines.slice(1).map((line) => `${eol}    ${line}`).join('')}`;
  if (editor.state.sliceDoc(opening.from, to) !== replacement) {
    editor.dispatch({ changes: { from: opening.from, to, insert: replacement } });
  }
}

function commitReferenceDefinition(
  editor: EditorView, from: number, label: string, destination: string, title: string,
): void {
  const line = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  if (!parseReferenceDefinition(line.text)) return;
  const safeLabel = label.replace(/[\]\r\n]/gu, '').trim() || 'reference';
  const safeDestination = destination.replace(/[\r\n<>]/gu, '').trim();
  const target = /\s/u.test(safeDestination) ? `<${safeDestination}>` : safeDestination;
  const safeTitle = title.replace(/[\r\n"]/gu, '').trim();
  const replacement = `[${safeLabel}]: ${target}${safeTitle ? ` "${safeTitle}"` : ''}`;
  if (replacement !== line.text) editor.dispatch({ changes: { from: line.from, to: line.to, insert: replacement } });
}

function commitCallout(editor: EditorView, from: number, type: string, content: string): void {
  const opening = editor.state.doc.lineAt(Math.min(from, editor.state.doc.length));
  if (!/^>\s*(?:\[!(?:Note|Tip|Important|Warning|Caution)\]|\*\*(?:Note|Tip|Important|Warning|Caution)\*\*)\s*$/iu.test(opening.text)) return;
  let endLine = opening.number;
  while (endLine < editor.state.doc.lines && /^>(?:\s|$)/u.test(editor.state.doc.line(endLine + 1).text)) endLine++;
  const to = editor.state.doc.line(endLine).to;
  const newline = editor.state.doc.toString().includes('\r\n') ? '\r\n' : '\n';
  const body = content.split(/\r?\n/u).map((line) => `> ${line}`).join(newline);
  const replacement = `> [!${type.toUpperCase()}]${body ? `${newline}${body}` : ''}`;
  editor.dispatch({ changes: { from: opening.from, to, insert: replacement } });
}

function addMetaDecoration(
  output: { from: number; to?: number; decoration: Decoration }[], from: number, to: number, expanded: boolean,
): void {
  if (to > from) output.push({
    from,
    to,
    decoration: Decoration.mark({ class: `markda-meta${expanded ? ' markda-meta-expanded' : ''}` }),
  });
}

function getStyles(): string { return String.raw`
:root{
  --markda-content-width:860px;--markda-font-body:"Open Sans","Clear Sans","Helvetica Neue",Helvetica,Arial,"Segoe UI","Yu Gothic UI","Hiragino Sans",sans-serif;
  --markda-font-mono:var(--vscode-editor-font-family,Consolas,"Liberation Mono",monospace);
  --markda-bg:#fff;--markda-fg:#333;--markda-muted:#777;
  --markda-link:#4183c4;--markda-link-hover:#2f6f9f;--markda-border:#dfe2e5;
  --markda-surface:#f8f8f8;--markda-inline-code:#f3f4f4;--markda-surface-secondary:#eef2f2;--markda-elevated:#fff;
  --markda-hover:#eaeef2;--markda-active:#dbeafe;--markda-selection:#b5d6fc;
  --markda-active-line:transparent;--markda-line-highlight:#0969da14;--markda-find-highlight:#fff8c5;--markda-focus:#0969da;
  --markda-find-widget:#f3f3f3;--markda-find-input:#fff;--markda-find-match:#f6b94a70;--markda-find-match-selected:#f59b2399;
  --markda-widget-shadow:#00000029;
  --markda-cursor-color:var(--markda-fg);--markda-accent:#0969da;--markda-error:#cf222e;
  --markda-syntax-comment:#6e7781;--markda-syntax-constant:#0550ae;--markda-syntax-entity:#8250df;
  --markda-syntax-keyword:#cf222e;--markda-syntax-string:#0a3069;--markda-syntax-variable:#953800;
  --markda-error-bg:#ffebe9;--markda-info:#0969da;--markda-info-bg:#ddf4ff;
  --markda-tip:#1a7f37;--markda-tip-bg:#dafbe1;--markda-warning:#9a6700;--markda-warning-bg:#fff8c5;
  --markda-scrollbar-track:transparent;--markda-scrollbar-thumb:#1f232847;
  --markda-scrollbar-thumb-hover:#1f23286b;--markda-scrollbar-thumb-active:#1f23288c;
}
:root[data-markda-color-mode="dark"]{
  --markda-bg:#1e1e1e;--markda-fg:#d4d4d4;--markda-muted:#a8a8a8;
  --markda-link:#75beff;--markda-link-hover:#a6d5ff;--markda-border:#4a4a4a;
  --markda-surface:#252526;--markda-inline-code:#252526;--markda-surface-secondary:#2d2d30;--markda-elevated:#252526;
  --markda-hover:#2a2d2e;--markda-active:#37373d;--markda-selection:#4a89dc;
  --markda-active-line:transparent;--markda-line-highlight:#ffffff0f;--markda-find-highlight:#515c6a;--markda-focus:#007fd4;
  --markda-find-widget:#252526;--markda-find-input:#3c3c3c;--markda-find-match:#ea5c0055;--markda-find-match-selected:#ea5c0088;
  --markda-widget-shadow:#0000005c;
  --markda-cursor-color:var(--markda-fg);--markda-accent:#7aa2f7;--markda-error:#f48771;
  --markda-syntax-comment:#8b949e;--markda-syntax-constant:#79c0ff;--markda-syntax-entity:#d2a8ff;
  --markda-syntax-keyword:#ff7b72;--markda-syntax-string:#a5d6ff;--markda-syntax-variable:#ffa657;
  --markda-error-bg:#3b1f23;--markda-info:#75beff;--markda-info-bg:#152b3c;
  --markda-tip:#89d185;--markda-tip-bg:#17351f;--markda-warning:#e2c08d;--markda-warning-bg:#352f15;
  --markda-scrollbar-thumb:#c8c8c866;--markda-scrollbar-thumb-hover:#c8c8c88c;--markda-scrollbar-thumb-active:#c8c8c8b3;
}
*{box-sizing:border-box;scrollbar-color:var(--markda-scrollbar-thumb) var(--markda-scrollbar-track);scrollbar-width:thin}::selection{background:var(--markda-selection)}
*::-webkit-scrollbar{width:10px;height:10px}*::-webkit-scrollbar-track{background:var(--markda-scrollbar-track)}
*::-webkit-scrollbar-thumb{background:var(--markda-scrollbar-thumb);border:2px solid transparent;border-radius:8px;background-clip:padding-box}
*::-webkit-scrollbar-thumb:hover{background-color:var(--markda-scrollbar-thumb-hover)}*::-webkit-scrollbar-thumb:active{background-color:var(--markda-scrollbar-thumb-active)}
*::-webkit-scrollbar-corner{background:var(--markda-bg)}
html,body,#app{height:100%;margin:0}body{overflow:hidden;color:var(--markda-fg);background:var(--markda-bg);font-family:var(--markda-font-body);-webkit-font-smoothing:antialiased}
.markda-link-text,.markda-source-link,#preview a{color:var(--markda-link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}.markda-link-text:hover,#preview a:hover{color:var(--markda-link-hover)}
.markda-meta{font-size:0!important;line-height:0!important;letter-spacing:0!important;color:transparent!important}.markda-meta.markda-meta-expanded{font-size:inherit!important;line-height:inherit!important;letter-spacing:inherit!important;color:var(--markda-muted)!important}
.markda-list-bullet-source{font-size:0;color:var(--markda-muted)}.markda-list-bullet-source::after{content:'•';display:inline-block;min-width:.8em;font-size:var(--vscode-editor-font-size);font-weight:700;text-align:center}.markda-list-bullet-source.markda-meta-expanded{font-size:inherit;color:inherit}.markda-list-bullet-source.markda-meta-expanded::after{content:none}
button{color:inherit;background:transparent;border:0;border-radius:4px;min-height:28px;padding:4px 8px;cursor:pointer}button:hover{background:var(--markda-hover)}button.active{background:var(--markda-active)}button:focus-visible,[tabindex]:focus-visible,[contenteditable]:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--markda-focus);outline-offset:2px}
.markda-shell{position:relative;height:100%;display:grid;grid-template-rows:minmax(0,1fr) 24px}.markda-toolbar{position:absolute;top:0;right:0;left:0;z-index:500;min-height:40px;padding:5px 10px;display:flex;align-items:center;gap:2px;overflow-x:auto;overflow-y:hidden;background:color-mix(in srgb,var(--markda-elevated) 92%,transparent);border:0;border-bottom:1px solid color-mix(in srgb,var(--markda-border) 78%,transparent);border-radius:0;box-shadow:none;backdrop-filter:blur(12px)}.markda-toolbar:not(.expanded)>:not(#toolbar-toggle){display:none}.markda-toolbar:not(.expanded){top:6px;right:8px;left:auto;min-height:32px;padding:2px;background:var(--markda-elevated);border:1px solid var(--markda-border);border-radius:8px;box-shadow:0 2px 8px color-mix(in srgb,var(--markda-widget-shadow) 55%,transparent)}.markda-toolbar button{display:flex;gap:5px;align-items:center;flex:0 0 auto;min-height:28px;border-radius:6px}.markda-toolbar button.active{color:var(--markda-accent);background:color-mix(in srgb,var(--markda-active) 72%,transparent)}.markda-style-picker select{height:28px;max-width:9em;padding:0 6px;color:var(--markda-fg);background:transparent;border:1px solid transparent;border-radius:6px}.markda-style-picker select:hover{background:var(--markda-hover)}.markda-style-picker select:focus-visible{outline:2px solid var(--markda-focus);outline-offset:-2px}.toolbar-separator{height:16px;border-left:1px solid color-mix(in srgb,var(--markda-border) 72%,transparent);margin:0 6px}.toolbar-spacer{flex:1}.math-icon{font:bold 17px serif}
.table-toolbar{grid-area:1/1;align-self:start;z-index:300;display:none;width:100%;min-height:42px;padding:7px 52px 7px 10px;align-items:center;gap:2px;border-bottom:1px solid var(--markda-border);background:var(--markda-surface);box-shadow:0 2px 8px var(--markda-widget-shadow);overflow-x:auto}.table-active .table-toolbar{display:flex}.table-toolbar>span:first-child{font-weight:600;margin-right:6px}.table-toolbar button{display:flex;gap:4px;align-items:center}.table-toolbar button:disabled{opacity:.4;cursor:default}
.markda-workspace{grid-area:1/1;display:grid;grid-template-columns:minmax(0,1fr);min-height:0}.preview-visible .markda-workspace{grid-template-columns:minmax(0,1fr) minmax(320px,42%)}#editor,#preview{min-width:0}#editor{overflow:hidden}#preview{display:none;overflow:auto;border-left:1px solid var(--markda-border);padding:48px 30px 30px;font-family:var(--markda-font-body);font-size:16px;line-height:1.6}.preview-visible #preview{display:block}
.cm-editor{height:100%;min-height:100%;font-family:var(--markda-font-body);font-size:var(--markda-font-size,16px);color:var(--markda-fg);background:transparent}.cm-editor.cm-focused{outline:none}.cm-editor .cm-scroller{padding:48px var(--markda-padding-x,30px) 100px;font-family:var(--markda-font-body);line-height:var(--markda-line-height,1.6)}.cm-content,[contenteditable]{caret-color:var(--markda-cursor-color)}.cm-editor .cm-content{max-width:var(--markda-content-width);margin:0 auto;font-family:var(--markda-font-body);line-height:var(--markda-line-height,1.6)}.cm-content:focus{outline:none}.cm-editor .cm-line{padding:0;transition:opacity .12s}.cm-editor .cm-line+.cm-line{margin-top:var(--markda-paragraph-spacing,0)}.cm-line.markda-thematic-blank-line{height:0;min-height:0;overflow:hidden;line-height:0}.cm-editor .cm-activeLine{background-color:var(--markda-active-line)!important}.cm-editor .cm-cursor,.cm-editor .cm-dropCursor{border-left:2px solid var(--markda-cursor-color)!important;margin-left:-1px;box-shadow:none}.cm-selectionBackground{background:var(--markda-selection)!important}
.cm-editor .markda-block-selection{position:relative}.cm-editor .markda-block-selection::after{content:"";position:absolute;inset:0;z-index:20;pointer-events:none;border:2px solid var(--markda-selection);border-radius:4px;background:color-mix(in srgb,var(--markda-selection) 48%,transparent)}
.cm-editor .cm-panels-top:has(.cm-search){position:absolute;top:0;right:14px;left:auto;z-index:600;color:var(--markda-fg);background:transparent;border:0}
.cm-editor .cm-panel.cm-search{position:relative;display:grid;grid-template-columns:minmax(150px,1fr) repeat(6,24px);grid-template-rows:24px 24px;gap:3px;width:min(454px,calc(100vw - 32px));padding:4px 28px;color:var(--markda-fg);background:var(--markda-find-widget);border:1px solid var(--markda-border);border-top:0;box-shadow:0 2px 8px var(--markda-widget-shadow);font:13px/1 var(--markda-font-body)}
.cm-editor .cm-panel.cm-search.markda-replace-collapsed{grid-template-rows:24px}.cm-search.markda-replace-collapsed input[name=replace],.cm-search.markda-replace-collapsed button[name=replace],.cm-search.markda-replace-collapsed button[name=replaceAll]{display:none!important}
.cm-search .cm-textfield{min-width:0;height:24px;margin:0!important;padding:2px 6px;color:var(--markda-fg);background:var(--markda-find-input);border:1px solid var(--markda-border);border-radius:0;font:inherit}.cm-search .cm-textfield:focus{outline:1px solid var(--markda-focus);outline-offset:-1px;border-color:var(--markda-focus)}
.cm-search input[name=search]{grid-area:1/1}.cm-search input[name=replace]{grid-area:2/1}.cm-search br{display:none}
.cm-editor .cm-panel.cm-search>button,.cm-editor .cm-panel.cm-search>label{display:grid;place-items:center;width:24px;height:24px;min-height:24px;margin:0!important;padding:0;border:0;border-radius:2px;color:var(--markda-fg);background:transparent;font-size:0!important;line-height:0;cursor:pointer}
.cm-search button:hover,.cm-search label:hover{background:var(--markda-hover)}.cm-search button:focus-visible,.cm-search label:focus-within{outline:1px solid var(--markda-focus);outline-offset:-1px}
.cm-search button::before,.cm-search label::after{font:16px/1 codicon}
.cm-search button[name=prev]{grid-area:1/5}.cm-search button[name=prev]::before{content:"\eab7"}.cm-search button[name=next]{grid-area:1/6}.cm-search button[name=next]::before{content:"\eab4"}.cm-search button[name=select]{grid-area:1/7}.cm-search button[name=select]::before{content:"\eb85"}
.cm-search label:has(input[name=case]){grid-area:1/2}.cm-search label:has(input[name=case])::after{content:"\eab1"}.cm-search label:has(input[name=word]){grid-area:1/3}.cm-search label:has(input[name=word])::after{content:"\eb7e"}.cm-search label:has(input[name=re]){grid-area:1/4}.cm-search label:has(input[name=re])::after{content:"\eb38"}
.cm-editor .cm-panel.cm-search>label>input[type=checkbox]{position:absolute;width:1px;height:1px;margin:0!important;opacity:0}.cm-search label:has(input:checked){color:var(--markda-accent);background:var(--markda-active);outline:1px solid var(--markda-focus);outline-offset:-1px}
.cm-search button[name=replace]{grid-area:2/5}.cm-search button[name=replace]::before{content:"\eb3d"}.cm-search button[name=replaceAll]{grid-area:2/6}.cm-search button[name=replaceAll]::before{content:"\eb3c"}
.cm-search button.markda-replace-toggle{position:absolute!important;top:4px!important;left:3px!important;margin:0!important}.cm-search button.markda-replace-toggle::before{content:"\eab4"}.cm-search.markda-replace-collapsed button.markda-replace-toggle::before{content:"\eab6"}
.cm-search button[name=close]{position:absolute!important;top:4px!important;right:3px!important;margin:0!important}.cm-search button[name=close]::before{content:"\ea76"}.cm-search button[name=close]{color:transparent!important}.cm-search button[name=close]::before{color:var(--markda-fg)}
.cm-editor .cm-searchMatch{background:var(--markda-find-match)!important}.cm-editor .cm-searchMatch-selected{background:var(--markda-find-match-selected)!important;outline:1px solid var(--markda-accent)}
.markda-h1,.markda-h2,.markda-h3,.markda-h4,.markda-h5,.markda-h6{font-weight:700;margin-top:1rem;margin-bottom:1rem}.markda-h1{font-size:2.25em;line-height:1.2;border-bottom:1px solid var(--markda-border)}.markda-h2{font-size:1.75em;line-height:1.225;border-bottom:1px solid var(--markda-border)}.markda-h3{font-size:1.5em;line-height:1.43}.markda-h4{font-size:1.25em}.markda-h5{font-size:1em}.markda-h6{font-size:1em;color:var(--markda-muted)}.markda-setext-marker{height:0;min-height:0;line-height:0;overflow:hidden}.markda-quote{border-left:4px solid var(--markda-border);padding-left:15px!important;color:var(--markda-muted)}.markda-list-marker{color:var(--markda-muted)}.markda-list-bullet{display:inline-block;min-width:.8em;color:var(--markda-fg);font-weight:700;text-align:center}
.markda-strong{font-weight:700}.markda-emphasis{font-style:italic}.markda-strike{text-decoration:line-through}.markda-subscript{font-size:.78em;vertical-align:sub}.markda-superscript{font-size:.78em;vertical-align:super}.markda-highlight{background:var(--markda-find-highlight);border-radius:2px}.markda-code{font-family:var(--markda-font-mono);font-size:.9em;background:var(--markda-inline-code);padding:0 2px;border:1px solid color-mix(in srgb,var(--markda-border) 70%,transparent);border-radius:3px}.markda-soft-break{white-space:pre}.markda-inline-math{padding:0 2px}.markda-inline-html,.markda-entity{cursor:pointer}.markda-inline-image{display:inline-flex;align-items:center;max-width:min(18em,70vw);max-height:4em;margin:0 .2em;padding:2px;border:1px solid transparent;border-radius:4px;vertical-align:middle;cursor:pointer}.markda-inline-image:hover{border-color:var(--markda-border)}.markda-inline-image img{display:block;max-width:100%;max-height:3.5em}.markda-inline-image-blocked{padding:1px 5px;color:var(--markda-muted);background:var(--markda-surface)}.markda-image-alt,.markda-footnote-source{color:var(--markda-muted)}.markda-footnote-reference{display:inline-block;min-width:1em;padding:0 2px;color:var(--markda-link);font-size:.75em;line-height:1;vertical-align:super;cursor:pointer}.markda-thematic-break{width:100%;height:2px;margin:16px 0;border:0;background:color-mix(in srgb,var(--markda-border) 75%,var(--markda-bg))}.markda-unfocused{opacity:.22}.source-mode .markda-h1,.source-mode .markda-h2,.source-mode .markda-h3,.source-mode .markda-h4,.source-mode .markda-h5,.source-mode .markda-h6{font-size:inherit;font-weight:inherit;line-height:inherit;color:inherit;border:0;margin:0}.source-mode .markda-unfocused{opacity:1}
.markda-emoji{display:inline-block;min-width:1em;text-align:center}.markda-diagnostic{text-decoration-line:underline;text-decoration-style:wavy;text-underline-offset:3px}.markda-diagnostic-error{text-decoration-color:var(--markda-error)}.markda-diagnostic-warning{text-decoration-color:var(--markda-warning)}.markda-diagnostic-information{text-decoration-color:var(--markda-info)}.markda-diagnostic-hint{text-decoration-color:var(--markda-muted)}
.markda-live-toc,.markda-front-matter{margin:12px 0;padding:14px 16px;border:1px solid var(--markda-border);border-radius:7px;background:var(--markda-surface)}.markda-live-toc ol{list-style:none;margin:8px 0 0;padding:0}.markda-live-toc li{margin-left:calc(var(--markda-toc-depth,0) * 18px)}.markda-live-toc button{min-height:24px;padding:2px 4px;color:var(--markda-link);text-align:left}.markda-toc-empty{display:block;margin-top:6px;color:var(--markda-muted);font-style:italic}
.markda-front-matter-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.markda-front-matter-header button{min-height:24px;font-size:12px}.markda-front-matter-fields{display:grid;gap:6px}.markda-front-matter-fields label{display:grid;grid-template-columns:minmax(7em,.4fr) minmax(10em,1fr);gap:10px;align-items:center}.markda-front-matter-fields input{min-width:0;padding:5px 7px;color:var(--markda-fg);background:var(--markda-bg);border:1px solid var(--markda-border)}.markda-front-matter-fields code{overflow:hidden;color:var(--markda-muted);text-overflow:ellipsis;white-space:nowrap}.markda-front-matter-source{min-height:8em}.markda-front-matter-error{color:var(--markda-error)}
.markda-task-checkbox{margin:0 6px 0 1px;vertical-align:baseline;width:1em;height:1em;accent-color:var(--markda-accent)}.markda-live-image{margin:12px 0;max-width:100%;width:max-content;overflow:auto;border:1px solid transparent;border-radius:6px;padding:6px}.markda-live-image:hover,.markda-live-image:focus-within{border-color:var(--markda-border)}.markda-live-image img{display:block;max-width:100%;max-height:70vh}.markda-live-image figcaption{color:var(--markda-muted);text-align:center;font-size:.9em}
.markda-image-controls{display:flex;justify-content:center;gap:4px;margin-top:4px;opacity:0;transition:opacity .12s}.markda-live-image:hover .markda-image-controls,.markda-live-image:focus-within .markda-image-controls{opacity:1}.markda-image-controls button{font-size:12px;min-height:24px}.markda-image-editor{display:grid;grid-template-columns:1fr 2fr;gap:6px;margin-top:6px}.markda-image-editor[hidden]{display:none}
.markda-image-editor label{grid-column:1/-1;display:flex;align-items:center;gap:8px}.markda-image-editor label input{flex:1}.markda-image-editor input,.markda-block-source-editor,dialog input{color:var(--markda-fg);background:var(--markda-surface);border:1px solid var(--markda-border);padding:6px}.markda-block-math-wrap{display:flow-root}.markda-block-source-editor{display:block;width:100%;min-height:0;overflow-y:hidden;resize:none;font-family:var(--vscode-editor-font-family);line-height:1.5}.markda-block-source-editor[hidden]{display:none}
.markda-footnote-definition{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;margin:.45em 0;padding:6px 9px;color:var(--markda-muted);background:var(--markda-surface);border-radius:4px}.markda-footnote-definition-content{min-height:1.5em;white-space:pre-wrap;outline:none}.markda-reference-definition{display:grid;grid-template-columns:minmax(7em,.5fr) auto minmax(10em,1fr) minmax(8em,.7fr);gap:6px;align-items:center;margin:.45em 0;padding:6px 9px;background:var(--markda-surface);border-radius:4px}.markda-reference-definition input{min-width:0;padding:4px 6px;color:var(--markda-fg);background:var(--markda-bg);border:1px solid var(--markda-border)}
.markda-html-block{margin:.6em 0;padding:8px;outline:none;border:1px solid transparent;border-radius:4px}.markda-html-block:focus-within{border-color:var(--markda-border)}.markda-html-block-content{outline:none}.markda-html-empty{color:var(--markda-muted);font-style:italic}
.markda-live-code{margin:15px 0;max-width:100%;overflow:auto;font-family:var(--markda-font-mono);font-size:.9em}.markda-live-code pre{margin:0;padding:8px 4px 6px;border:1px solid var(--markda-border);border-radius:4px;background:var(--markda-surface)}.markda-live-code code[contenteditable]{display:block;min-height:1.5em;white-space:pre;outline:none;color:var(--markda-fg)}.markda-syntax-comment{color:var(--markda-syntax-comment)}.markda-syntax-constant{color:var(--markda-syntax-constant)}.markda-syntax-entity{color:var(--markda-syntax-entity)}.markda-syntax-keyword{color:var(--markda-syntax-keyword)}.markda-syntax-string{color:var(--markda-syntax-string)}.markda-syntax-variable{color:var(--markda-syntax-variable)}.markda-code-rendered{padding:10px}
.markda-fenced-code{overflow:hidden;border:1px solid var(--markda-border);border-radius:4px;background:var(--markda-surface)}.markda-fenced-code pre{overflow:auto;border:0;border-radius:0}.markda-code-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:4px;min-height:26px;padding:2px 3px;background:var(--markda-surface);border-bottom:1px solid var(--markda-border)}.markda-code-toolbar input{width:10em;min-width:0;padding:2px 5px;color:var(--markda-muted);background:transparent;border:0;font:inherit;text-align:left}.markda-code-toolbar input:focus-visible{outline:1px solid var(--markda-focus);outline-offset:-1px;border-radius:2px}.markda-code-toolbar button{display:grid;place-items:center;width:24px;min-height:22px;padding:1px;color:var(--markda-fg);border-radius:2px}.markda-code-toolbar button:hover{background:var(--markda-hover)}
.markda-trailing-paragraph{min-height:1.7em;margin-top:2px;border-radius:3px;cursor:text}.markda-trailing-paragraph:hover,.markda-trailing-paragraph:focus{background:var(--markda-line-highlight);outline:none}.markda-trailing-paragraph:focus::before{content:"";display:inline-block;height:1.35em;border-left:2px solid var(--markda-cursor-color);box-shadow:none;vertical-align:middle}
.markda-live-table-wrap{overflow:auto;margin:.8em 0;color:var(--markda-fg)}.markda-live-table-wrap table{border-collapse:collapse;width:100%;color:var(--markda-fg);background:var(--markda-bg)}.markda-live-table-wrap tbody tr:nth-child(2n){background:var(--markda-surface)}.markda-live-table-wrap th,.markda-live-table-wrap td{border:1px solid var(--markda-border);padding:6px 13px;min-width:70px;resize:horizontal;overflow:auto;color:var(--markda-fg);background:transparent}.markda-live-table-wrap th{font-weight:700;background:var(--markda-surface)}.markda-live-table-wrap th:focus-visible,.markda-live-table-wrap td:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--markda-focus)}.markda-live-table-wrap code{padding:0 2px;color:var(--markda-fg);background:var(--markda-inline-code);border:1px solid var(--markda-border);border-radius:3px;font-family:var(--markda-font-mono);font-size:.9em}.markda-large-table{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border:1px solid var(--markda-border);border-radius:5px;color:var(--markda-muted)}
.markda-callout{margin:12px 0;padding:12px 16px;border-radius:6px;border-left:4px solid;background:var(--markda-surface)}.markda-callout-title{font-weight:600;margin-bottom:4px}.markda-callout-content{color:var(--markda-fg)}.markda-callout-edit{margin-top:8px;font-size:11px;padding:2px 8px;opacity:0}.markda-callout:hover .markda-callout-edit,.markda-callout-edit:focus-visible{opacity:1}
.markda-callout-note{border-color:var(--markda-info);background:var(--markda-info-bg)}.markda-callout-note .markda-callout-title{color:var(--markda-info)}.markda-callout-tip{border-color:var(--markda-tip);background:var(--markda-tip-bg)}.markda-callout-tip .markda-callout-title{color:var(--markda-tip)}
.markda-callout-important,.markda-callout-warning{border-color:var(--markda-warning);background:var(--markda-warning-bg)}.markda-callout-important .markda-callout-title,.markda-callout-warning .markda-callout-title{color:var(--markda-warning)}.markda-callout-caution{border-color:var(--markda-error);background:var(--markda-error-bg)}.markda-callout-caution .markda-callout-title{color:var(--markda-error)}
dialog{color:var(--markda-fg);background:var(--markda-elevated);border:1px solid var(--markda-border);border-radius:7px;box-shadow:0 8px 28px #0007}dialog::backdrop{background:#0007}dialog form{display:grid;gap:14px;min-width:300px}dialog h2{font-size:16px;margin:0}dialog label{display:flex;justify-content:space-between;gap:20px;align-items:center}dialog input{width:min(320px,55vw);padding:5px;color:var(--markda-fg);background:var(--markda-bg);border:1px solid var(--markda-border)}#table-dialog input{width:76px}dialog form>div{display:flex;justify-content:flex-end;gap:8px}
.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.markda-status{grid-row:2;display:flex;align-items:center;gap:2px;min-width:0;padding:0 8px;color:var(--markda-muted);background:var(--markda-surface);border-top:1px solid var(--markda-border);font-size:12px}.markda-status button,.markda-status span{min-height:20px;padding:1px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.markda-status button{color:inherit}.markda-status button:hover{color:var(--markda-fg)}#document-section-status{max-width:32vw}#document-sync-status[data-state=conflict]{color:var(--markda-error)}#document-sync-status[data-state=pending],#document-sync-status[data-state=saving]{color:var(--markda-accent)}
.markda-quick-insert{position:fixed;z-index:900;width:300px;max-height:360px;padding:6px;color:var(--markda-fg);background:var(--markda-elevated);border:1px solid var(--markda-border);border-radius:7px;box-shadow:0 8px 28px #0007}.markda-quick-insert[hidden]{display:none}.markda-quick-insert input{width:100%;padding:7px;color:var(--markda-fg);background:var(--markda-bg);border:1px solid var(--markda-border);border-radius:4px}.markda-quick-insert [role=listbox]{max-height:305px;margin-top:5px;overflow:auto}.markda-quick-insert [role=option]{display:flex;width:100%;align-items:center;gap:8px;text-align:left}.markda-quick-insert [role=option]:focus{background:var(--markda-active);outline:1px solid var(--markda-focus)}.markda-quick-insert-empty{display:block;padding:10px;color:var(--markda-muted)}
.markda-selection-toolbar{position:fixed;z-index:850;display:flex;padding:2px;color:var(--markda-fg);background:var(--markda-elevated);border:1px solid var(--markda-border);border-radius:5px;box-shadow:0 4px 16px #0005}.markda-selection-toolbar[hidden]{display:none}.markda-selection-toolbar button{min-height:26px;padding:2px 7px}
.markda-welcome{position:absolute;top:38%;left:50%;z-index:2;display:grid;gap:8px;width:min(480px,80vw);padding:24px;transform:translate(-50%,-50%);color:var(--markda-muted);text-align:center;pointer-events:none}.markda-welcome strong{color:var(--markda-fg);font-size:1.3em}.markda-welcome[hidden]{display:none}
body[data-markda-theme="midnight"] .markda-h1,body[data-markda-theme="midnight"] .markda-h2{color:var(--markda-accent)}
#preview{color:var(--markda-fg);background:var(--markda-bg)}#preview h1,#preview h2,#preview h3,#preview h4,#preview h5,#preview h6{position:relative;margin:1rem 0;color:var(--markda-fg);font-weight:700;line-height:1.4}#preview h1{font-size:2.25em;line-height:1.2;border-bottom:1px solid var(--markda-border)}#preview h2{font-size:1.75em;line-height:1.225;border-bottom:1px solid var(--markda-border)}#preview h3{font-size:1.5em;line-height:1.43}#preview h4{font-size:1.25em}#preview h5{font-size:1em}#preview h6{font-size:1em;color:var(--markda-muted)}#preview p,#preview blockquote,#preview ul,#preview ol,#preview dl,#preview table{margin:.8em 0}#preview ul,#preview ol{padding-left:30px}#preview li>ul,#preview li>ol{margin:0}#preview hr{box-sizing:content-box;height:2px;margin:16px 0;padding:0;overflow:hidden;border:0;background:color-mix(in srgb,var(--markda-border) 75%,var(--markda-bg))}#preview pre{overflow:auto;margin:15px 0;padding:8px 4px 6px;color:var(--markda-fg);background:var(--markda-surface);border:1px solid var(--markda-border);border-radius:3px}#preview code{font-family:var(--markda-font-mono);font-size:.9em;color:var(--markda-fg)}#preview :not(pre)>code{padding:0 2px;background:var(--markda-inline-code);border:1px solid var(--markda-border);border-radius:3px}#preview pre code{padding:0;color:var(--markda-fg);background:transparent;border:0}#preview blockquote{padding:0 15px;color:var(--markda-muted);background:transparent;border-left:4px solid var(--markda-border)}#preview blockquote p{color:inherit}#preview table{border-collapse:collapse;width:100%;padding:0;color:var(--markda-fg);background:var(--markda-bg);word-break:initial}#preview tr:nth-child(2n),#preview thead{background:var(--markda-surface)}#preview th,#preview td{border:1px solid var(--markda-border);padding:6px 13px;color:var(--markda-fg);background:transparent}#preview th{font-weight:700}#preview input{accent-color:var(--markda-accent)}#preview img{max-width:100%}.markda-render-error{color:var(--markda-error)}.markda-remote-blocked{display:inline-block;padding:8px 10px;border:1px dashed var(--markda-border);color:var(--markda-muted)}
#preview .markda-toc{margin:1em 0;padding:12px 16px;border:1px solid var(--markda-border);border-radius:6px;background:var(--markda-surface)}#preview .markda-toc ul{list-style:none;margin:0;padding:0}#preview .markda-toc-level-1{margin-left:18px}#preview .markda-toc-level-2{margin-left:36px}#preview .markda-toc-level-3{margin-left:54px}#preview .markda-toc-level-4,#preview .markda-toc-level-5{margin-left:72px}
@media(min-width:1100px){.markda-toolbar:not(.expanded)>:not(#toolbar-toggle){display:flex}.markda-toolbar:not(.expanded)>.markda-style-picker{display:block}.markda-toolbar:not(.expanded)>.toolbar-separator{display:block}.markda-toolbar:not(.expanded){top:0;right:0;left:0;min-height:40px;padding:5px 10px;background:color-mix(in srgb,var(--markda-elevated) 92%,transparent);border:0;border-bottom:1px solid color-mix(in srgb,var(--markda-border) 78%,transparent);border-radius:0;box-shadow:none}.markda-toolbar>#toolbar-toggle{display:none}}
@media(max-width:760px){.markda-toolbar button span:not(.math-icon){display:none}.markda-style-picker{display:none!important}.preview-visible .markda-workspace{grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(180px,1fr)}#preview{border-left:0;border-top:1px solid var(--markda-border)}.cm-scroller{padding-left:20px;padding-right:20px}#document-section-status{display:none}}
  @media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`; }

// Start only after every widget class above has been initialized. applySettings()
// dispatches a synchronous live-preview refresh; running it earlier can evaluate
// an initial math/code/table range while its widget class is still in the temporal
// dead zone. CodeMirror then disables the crashed view plugin for the whole editor.
applyViewState(initialViewState);
if (initialDocument) {
  applySettings(true);
  scheduleDerivedStateUpdate();
  if (initialDocument.text.includes(':')) void loadFullEmoji();
}
vscode.postMessage({ type: 'ready' });
