// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

function setupEditor(text: string): void {
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
  vi.stubGlobal('acquireVsCodeApi', () => ({
    getState: () => undefined,
    setState: vi.fn(),
    postMessage: vi.fn(),
  }));
}

async function tick(): Promise<void> {
  // Let the constructor's requestAnimationFrame(refreshLivePreview) and the
  // queueMicrotask(blockDecorationsField) settle before asserting.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live Markdown webview cursor + block decorations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('renders inline bold (**text**) with hidden markers and bold styling', async () => {
    vi.resetModules();
    setupEditor('This is **bold** text.');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    // Source markers are painted transparent (not removed from the DOM).
    expect(view.dom.querySelectorAll('.markda-hide-marker').length).toBeGreaterThanOrEqual(2);
    // The inner text must be wrapped in a bold styled element.
    const strong = view.dom.querySelector('.markda-strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold');
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
});
