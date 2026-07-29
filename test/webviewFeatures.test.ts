// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

function setupEditor(text: string): ReturnType<typeof vi.fn> {
  document.body.innerHTML = '<div id="app"><div id="editor"></div></div>';
  (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
    type: 'initialize',
    uri: 'file:///features.md',
    resourceBaseUri: 'file:///',
    themeBaseUri: 'data:text/css,',
    version: 1,
    text,
    settings: {
      contentWidth: 860,
      autoPairMarkdown: true,
      typewriterKeepCentered: true,
      previewUpdateDelay: 500,
      liveTableMaxCells: 600,
      themeMode: 'auto',
      markdown: { math: false, diagrams: false, html: false, breaks: false },
      theme: { light: 'paper', dark: 'midnight' },
      security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
    },
  };
  const postMessage = vi.fn();
  vi.stubGlobal('acquireVsCodeApi', () => ({
    getState: () => undefined,
    setState: vi.fn(),
    postMessage,
  }));
  return postMessage;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live document features', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial;
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('renders Front Matter, TOC, and emoji without rewriting their source', async () => {
    vi.resetModules();
    const source = ['---', 'title: Demo', 'draft: false', '---', '', '# Start', '', '[toc]', '', 'Ship :rocket:.'].join('\n');
    setupEditor(source);
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    const deadline = Date.now() + 2_000;
    while (!view.dom.querySelector('.markda-emoji') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(view.dom.querySelector('.markda-front-matter')).not.toBeNull();
    expect(view.dom.querySelector('.markda-live-toc')?.textContent).toContain('Start');
    expect(view.dom.querySelector('.markda-emoji')?.textContent).toBe('🚀');
    expect(view.state.doc.toString()).toBe(source);
  });

  it('maps VS Code diagnostics into live editor decorations', async () => {
    vi.resetModules();
    setupEditor('Misspelled word');
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'diagnosticsChanged',
        diagnostics: [{ from: 0, to: 10, severity: 'warning', message: 'Possible typo', source: 'spell' }],
      },
    }));
    const diagnostic = __getEditorView().dom.querySelector<HTMLElement>('.markda-diagnostic-warning');
    expect(diagnostic?.title).toContain('spell: Possible typo');
  });

  it('keeps secondary controls discoverable, keyboard-operable, and safely cancellable', async () => {
    vi.resetModules();
    const postMessage = setupEditor('&copy;\n\n![Diagram](diagram.png)');
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();

    const entity = view.dom.querySelector<HTMLElement>('.markda-entity')!;
    expect(entity.getAttribute('role')).toBe('button');
    entity.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(view.state.selection.main.head).toBe(1);

    const imageEditor = view.dom.querySelector<HTMLElement>('.markda-image-editor')!;
    const editImage = Array.from(view.dom.querySelectorAll<HTMLButtonElement>('.markda-image-controls button'))
      .find((button) => button.textContent === 'Edit here')!;
    expect(editImage).toBeDefined();
    editImage.click();
    expect(imageEditor.hidden).toBe(false);

    const theme = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
    const toolbar = document.querySelector<HTMLElement>('#editor-toolbar')!;
    expect(document.querySelector('#toolbar-toggle')).toBeNull();
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    const toolbarItems = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-item]'));
    expect(toolbarItems.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(toolbarItems.filter((item) => item.tabIndex === -1)).toHaveLength(toolbarItems.length - 1);
    toolbarItems[0]!.focus();
    toolbarItems[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(toolbarItems[1]);
    expect(__getEditorView().contentDOM.getAttribute('aria-label')).toBe('markda Markdown editor');
    expect(document.querySelector('.markda-status')?.getAttribute('aria-label')).not.toContain('{0}');
    expect(toolbar.querySelectorAll<HTMLButtonElement>('button[data-command]').length).toBeGreaterThan(0);
    expect(theme.hasAttribute('aria-pressed')).toBe(false);
    expect(theme.getAttribute('aria-label')).toContain('Current theme: Auto');
    theme.click();
    expect(theme.dataset.mode).toBe('light');
    expect(theme.textContent).toContain('Theme: Light');

    const shortcutPriority = document.querySelector<HTMLButtonElement>('#shortcut-priority-toggle')!;
    expect(shortcutPriority.textContent).toContain('Shortcuts: VS Code');
    expect(shortcutPriority.getAttribute('aria-pressed')).toBe('false');
    postMessage.mockClear();
    shortcutPriority.click();
    expect(shortcutPriority.textContent).toContain('Shortcuts: Markda');
    expect(shortcutPriority.getAttribute('aria-pressed')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({ type: 'updateDefaultKeybindings', enabled: true });

    expect(document.querySelector<HTMLButtonElement>('button[value=cancel]')?.formNoValidate).toBe(true);
  });

  it('offers document-style formatting, link editing, status, and quick fixes without source-mode detours', async () => {
    vi.resetModules();
    const postMessage = setupEditor('A paragraph');
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();

    const style = document.querySelector<HTMLSelectElement>('#paragraph-style')!;
    style.value = '2';
    style.dispatchEvent(new Event('change'));
    expect(view.state.doc.toString()).toBe('## A paragraph');

    view.dispatch({ selection: { anchor: 3, head: view.state.doc.length } });
    document.querySelector<HTMLButtonElement>('[data-command=insertLink]')!.click();
    await settle();
    const dialog = document.querySelector<HTMLDialogElement>('#link-dialog')!;
    expect(dialog.open).toBe(true);
    document.querySelector<HTMLInputElement>('#link-url')!.value = 'https://example.com';
    dialog.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', {
      submitter: document.querySelector('#link-insert-confirm')!,
    }));
    expect(view.state.doc.toString()).toContain('[A paragraph](https://example.com)');

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'diagnosticsChanged',
        diagnostics: [{ from: 3, to: 4, severity: 'warning', message: 'Fix me', source: 'test' }],
      },
    }));
    document.querySelector<HTMLButtonElement>('#document-problems-status')!.click();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'requestCodeActions' }));
    expect(document.querySelector('#document-statistics-status')?.textContent).toContain('words');
    expect(document.querySelectorAll('#quick-insert-items')).toHaveLength(1);
  });

  it('runs Markda formatting shortcuts only when Markda has priority', async () => {
    vi.resetModules();
    setupEditor('word');
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    expect(view.state.doc.toString()).toBe('word');

    document.querySelector<HTMLButtonElement>('#shortcut-priority-toggle')!.click();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    expect(view.state.doc.toString()).toBe('**word**');
  });
});
