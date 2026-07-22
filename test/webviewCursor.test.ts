// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

function setupEditor(text: string): ReturnType<typeof vi.fn> {
  // The webview HTML template mounts the editor into #editor; recreate it here
  // before importing main.js so the EditorView has a parent element.
  document.body.innerHTML = '<div id="app"><div id="editor"></div></div>';
  (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
    type: 'initialize', uri: 'file:///cursor.md', resourceBaseUri: 'file:///', themeBaseUri: 'data:text/css,',
    version: 1, text,
    settings: {
      contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
      previewUpdateDelay: 500, liveTableMaxCells: 600,
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

async function tick(): Promise<void> {
  // Let the constructor's requestAnimationFrame(refreshLivePreview) and the
  // queueMicrotask(blockDecorationsField) settle before asserting.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live Markdown webview cursor + block decorations', { timeout: 10_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
    delete (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial;
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('moves the cursor up by exactly one line on ArrowUp (not to position 0)', async () => {
    vi.resetModules();
    const lines = ['# Heading', '', 'first paragraph', 'second paragraph', 'third paragraph'];
    setupEditor(lines.join('\n'));
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const doc = view.state.doc;
    // Place the cursor at the start of the third paragraph (line 3).
    const startLine3 = doc.line(3).from;
    const endLine2 = doc.line(2).from;
    view.dispatch({ selection: { anchor: startLine3 } });
    view.focus();

    expect(view.state.selection.main.head).toBe(startLine3);

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);

    // ArrowUp must move to line 2, NOT jump to position 0 (document top).
    expect(view.state.selection.main.head).toBe(endLine2);
    expect(view.state.selection.main.head).not.toBe(0);
  });

  it('renders a fenced code block as a live block widget', async () => {
    vi.resetModules();
    const text = ['Intro paragraph.', '', '```js', 'const x = 1;', '```', '', 'Trailing text.'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const widget = view.dom.querySelector('.markda-live-code');
    expect(widget).not.toBeNull();
    // The source fence syntax must be hidden behind the widget.
    expect(view.dom.textContent).not.toContain('```js');
  });

  it('sends the latest editor snapshot before handling Ctrl+S', async () => {
    vi.resetModules();
    const postMessage = setupEditor('before');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();
    postMessage.mockClear();

    const view = __getEditorView();
    const blur = vi.spyOn(view.contentDOM, 'blur');
    view.dispatch({ changes: { from: 6, insert: ' after' } });
    const event = new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(blur).not.toHaveBeenCalled();
    const messages = postMessage.mock.calls.map(([message]) => message as { type: string; text?: string });
    expect(messages.at(-1)).toMatchObject({ type: 'save', text: 'before after' });
  });

  it('includes edits made while the preceding transaction is awaiting acknowledgement', async () => {
    vi.resetModules();
    const postMessage = setupEditor('start');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();
    postMessage.mockClear();

    const view = __getEditorView();
    view.dispatch({ changes: { from: 5, insert: '-first' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'edit' });

    view.dispatch({ changes: { from: 11, insert: '-tail' } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    }));

    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'save', expectedText: 'start-first', text: 'start-first-tail',
    });
  });

  it('leaves the Save As shortcut to VS Code', async () => {
    vi.resetModules();
    const postMessage = setupEditor('unchanged');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();
    postMessage.mockClear();

    const event = new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    __getEditorView().contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'save' }));
  });

  it('does not reparse an active code block closing fence as a new opener', async () => {
    vi.resetModules();
    const text = ['```text', 'inside block', '```', '', 'Ordinary paragraph after the block.'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.state.selection.main.head).toBe(0);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await tick();
    const widget = view.dom.querySelector('.markda-live-code');
    expect(widget).not.toBeNull();
    expect(widget?.textContent).toContain('inside block');
    expect(widget?.textContent).not.toContain('Ordinary paragraph after the block.');
  });

  it('renders inline bold (**text**) with hidden markers and bold styling', async () => {
    vi.resetModules();
    setupEditor('This is **bold** text.');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    // Source markers stay in the DOM so CodeMirror keeps a stable position map,
    // but are collapsed through CSS until the caret enters the span.
    expect(view.dom.querySelectorAll('.markda-meta')).toHaveLength(2);
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
    // The inner text must be wrapped in a bold styled element.
    const strong = view.dom.querySelector('.markda-strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold');
  });

  it('returns selected Markdown and inline math to WYSIWYG after the selection leaves them', async () => {
    vi.resetModules();
    const text = 'Before **bold** and $x^2$ after.';
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const boldFrom = text.indexOf('bold');
    view.dispatch({ selection: { anchor: boldFrom, head: boldFrom + 4 } });
    await tick();
    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);

    const mathFrom = text.indexOf('x^2');
    view.dispatch({ selection: { anchor: mathFrom, head: mathFrom + 3 } });
    await tick();
    expect(view.dom.querySelector('.markda-inline-math-source')).not.toBeNull();
    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);

    view.dispatch({ selection: { anchor: text.length } });
    await tick();
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
    expect(view.dom.querySelector('.markda-inline-math-source')).toBeNull();
    expect(view.dom.querySelector('.markda-inline-math')).not.toBeNull();
  });

  it('hides a leading heading marker at the initial caret boundary', async () => {
    vi.resetModules();
    setupEditor('# Support');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.state.selection.main.head).toBe(0);
    expect(view.dom.querySelector('.markda-meta')).not.toBeNull();
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
  });

  it.each(['mouseup', 'pointercancel'])('freezes inline decorations during pointer selection and settles them once after %s', async (finishEvent) => {
    vi.resetModules();
    setupEditor(['first paragraph', 'second paragraph', 'third paragraph'].join('\n'));
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'before **bold** after' } });
    await tick();
    const marker = view.dom.querySelector('.markda-meta')!;
    const point = view.domAtPos(10);
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: point.node, offset: point.offset }),
    });
    const down = new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
    });
    view.contentDOM.dispatchEvent(down);
    expect(marker.classList.contains('markda-meta-expanded')).toBe(false);

    window.dispatchEvent(new MouseEvent(finishEvent, { bubbles: true, button: 0 }));
    await tick();
    expect(view.state.selection.main.head).toBe(10);
    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);
  });

  it('does not collapse a drag selection to the captured mousedown position', async () => {
    vi.resetModules();
    setupEditor('drag this selection');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    vi.spyOn(view, 'posAtCoords').mockReturnValue(4);
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 20, right: 20, top: 20, bottom: 38 });
    view.dispatch({ selection: { anchor: 2, head: 9 } });
    view.dom.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: 20, clientY: 28,
    }));
    view.dom.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 80, clientY: 28,
    }));
    await tick();

    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(9);
  });

  it.each([
    ['Shift-click', { detail: 1, shiftKey: true }],
    ['double-click', { detail: 2, shiftKey: false }],
  ])('does not correct %s', async (_label, eventOptions) => {
    vi.resetModules();
    setupEditor('leave modified clicks alone');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    vi.spyOn(view, 'posAtCoords').mockReturnValue(4);
    const options = {
      bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 28, ...eventOptions,
    };
    view.dispatch({ selection: { anchor: 11 } });
    view.dom.dispatchEvent(new MouseEvent('click', options));
    await tick();

    expect(view.state.selection.main.head).toBe(11);
  });

  it('leaves rendered link clicks to the link widget', async () => {
    vi.resetModules();
    setupEditor('Open [Markda](https://example.com) now.');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.dispatch({ selection: { anchor: 12 } });
    await tick();

    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);
  });

  it('renders a block math ($$...$$) as a live block widget, not raw source', async () => {
    vi.resetModules();
    const text = ['Before math.', '', '$$', '\\int_0^1 x^2\\,dx = \\frac{1}{3}', '$$', '', 'After math.'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const widget = view.dom.querySelector('.markda-block-math');
    expect(widget).not.toBeNull();
    // The opening/closing $$ delimiters must be hidden behind the widget.
    expect(view.dom.textContent).not.toContain('$$');
  });

  it('returns an open block math editor to its rendered view when touched outside', async () => {
    vi.resetModules();
    const text = ['Before math.', '', '$$', 'x^2', '$$', '', 'After math.'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const rendered = view.dom.querySelector<HTMLElement>('.markda-block-math')!;
    const source = view.dom.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')!;
    rendered.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(source.hidden).toBe(false);
    expect(rendered.hidden).toBe(true);
    source.value = 'x^3';
    source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    view.contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await tick();

    expect(source.hidden).toBe(true);
    expect(rendered.hidden).toBe(false);
    expect(view.state.doc.toString()).toContain('x^3');
  });

  it('returns an open Mermaid source editor to its rendered view when touched outside', async () => {
    vi.resetModules();
    const text = ['Before diagram.', '', '```mermaid', 'graph TD', '  A --> B', '```', '', 'After diagram.'].join('\n');
    setupEditor(text);
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { diagrams: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.diagrams = true;
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const rendered = view.dom.querySelector<HTMLElement>('[data-markda-renderer="mermaid"]')!;
    const source = view.dom.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')!;
    rendered.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(source.hidden).toBe(false);
    expect(rendered.hidden).toBe(true);
    source.value = ['graph TD', '  A --> C'].join('\n');
    source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    view.contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await tick();

    expect(view.dom.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')?.hidden).toBe(true);
    expect(view.dom.querySelector<HTMLElement>('[data-markda-renderer="mermaid"]')?.hidden).toBe(false);
    expect(view.state.doc.toString()).toContain('A --> C');
  });

  it('renders a GitHub alert and includes its quoted body', async () => {
    vi.resetModules();
    setupEditor(['Before alert.', '', '> [!WARNING]', '> Review this before publishing.', '', 'After alert.'].join('\n'));
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await tick();
    const widget = view.dom.querySelector('.markda-callout-warning');
    expect(widget).not.toBeNull();
    expect(widget?.querySelector('.markda-callout-title')?.textContent).toBe('Warning');
    expect(widget?.querySelector('.markda-callout-content')?.textContent).toBe('Review this before publishing.');
  });
});
