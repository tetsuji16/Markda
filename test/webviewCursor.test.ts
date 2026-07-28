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
      enableDefaultKeybindings: true,
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
    expect(widget?.classList.contains('markda-fenced-code')).toBe(true);
    expect(widget?.querySelector('.markda-code-toolbar + pre code[contenteditable="true"]')).not.toBeNull();
    expect(widget?.querySelector('.markda-syntax-keyword')?.textContent).toBe('const');
    expect(widget?.querySelector('.markda-syntax-constant')?.textContent).toBe('1');
    // The source fence syntax must be hidden behind the widget.
    expect(view.dom.textContent).not.toContain('```js');
  });

  it('highlights a rendered block only when a non-empty source selection overlaps it', async () => {
    vi.resetModules();
    const text = ['Before.', '```js', 'const answer = 42;', '```', 'After.'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const codeFrom = text.indexOf('```js');
    const codeTo = text.indexOf('```', codeFrom + 3) + 3;

    view.dispatch({ selection: { anchor: codeFrom + 2 } });
    expect(view.dom.querySelector('.markda-block-selection')).toBeNull();

    view.dispatch({ selection: { anchor: codeFrom + 2, head: codeFrom + 3 } });
    const selectedBlock = view.dom.querySelector<HTMLElement>('.markda-block-selection');
    expect(selectedBlock).not.toBeNull();
    expect(selectedBlock?.classList.contains('markda-live-code')).toBe(true);

    // The replacement owns the following newline only for layout.
    view.dispatch({ selection: { anchor: codeTo, head: codeTo + 1 } });
    expect(view.dom.querySelector('.markda-block-selection')).toBeNull();

    view.dispatch({ selection: { anchor: 2, head: text.indexOf('After') + 2 } });
    expect(view.dom.querySelectorAll('.markda-block-selection')).toHaveLength(1);
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

  it('converts a Setext heading to an ATX heading with the Typora shortcut', async () => {
    vi.resetModules();
    setupEditor('Title\n===\nAfter');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: '3', ctrlKey: true, bubbles: true, cancelable: true,
    }));

    expect(view.state.doc.toString()).toBe('### Title\nAfter');
    expect(view.state.selection.main.head).toBe(4);
  });

  it('keeps every mixed block rendered from one stable document-wide decoration set', async () => {
    vi.resetModules();
    setupEditor([
      '# Quick Cheat Sheet',
      '',
      '---',
      '',
      '### 1. Math',
      '$$J(\\theta) = x^2$$',
      '',
      '### 2. Table',
      '| Feature | Status |',
      '| :-- | :--: |',
      '| Preview | Done |',
      '',
      '### 3. Code',
      '```python',
      'print("ready")',
      '```',
    ].join('\n'));
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { math: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.math = true;

    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.dom.querySelector('.markda-thematic-break')).not.toBeNull();
    expect(view.dom.querySelector('.markda-block-math')).not.toBeNull();
    expect(view.dom.querySelector('.markda-live-table-wrap')).not.toBeNull();
    expect(view.dom.querySelector('.markda-live-code')).not.toBeNull();
    expect(view.dom.textContent).not.toContain('$$J(');
    expect(view.dom.textContent).not.toContain('| :-- |');
    expect(view.dom.textContent).not.toContain('```python');
  });

  it('flushes an active block editor on Ctrl+S without closing or blurring it', async () => {
    vi.resetModules();
    const text = ['```mermaid', 'graph TD; A-->B', '```'].join('\n');
    const postMessage = setupEditor(text);
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { diagrams: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.diagrams = true;
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const rendered = view.dom.querySelector<HTMLElement>('[data-markda-renderer="mermaid"]')!;
    rendered.click();
    const source = view.dom.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')!;
    expect(source.hidden).toBe(false);
    expect(document.activeElement).toBe(source);

    source.value = 'graph TD; A-->C';
    source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    postMessage.mockClear();
    const event = new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    });
    source.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(source.hidden).toBe(false);
    expect(view.state.doc.toString()).toContain('A-->C');
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'save', text: expect.stringContaining('A-->C'),
    });
  });

  it('does not rewrite an unchanged active table when saving', async () => {
    vi.resetModules();
    const text = ['### Data', '', '| Feature | Status |', '| --- | --- |', '| Import | Done |'].join('\n');
    const postMessage = setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const cell = view.dom.querySelector<HTMLElement>('.markda-live-table-wrap td')!;
    cell.focus();
    postMessage.mockClear();
    const stateBeforeSave = view.state;
    cell.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    }));

    expect(view.state).toBe(stateBeforeSave);
    expect(view.state.doc.toString()).toBe(text);
    expect(view.dom.querySelector('.markda-live-table-wrap')).not.toBeNull();
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'save', text });
  });

  it('does not rewrite an unchanged active code block when saving', async () => {
    vi.resetModules();
    const source = [
      'y_pred = torch.sigmoid(torch.tensor([0.5, -1.2]))',
      'print(f"Predictions: {y_pred.tolist()}")',
    ].join('\n');
    const text = ['# 1行でモデル推論', '', '```python', source, '```'].join('\n');
    const postMessage = setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const code = view.dom.querySelector<HTMLElement>('.markda-live-code code[contenteditable]')!;
    code.focus();
    postMessage.mockClear();
    const stateBeforeSave = view.state;

    for (let index = 0; index < 3; index++) {
      code.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', ctrlKey: true, bubbles: true, cancelable: true,
      }));
    }

    expect(view.state).toBe(stateBeforeSave);
    expect(view.state.doc.toString()).toBe(text);
    expect(code.textContent).toBe(source);
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'save', text });
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

  it('renders thematic breaks and keeps Setext headings distinct from them', async () => {
    vi.resetModules();
    const text = ['Title', '===', '', 'Section', '---', '', '- - -', '', '___', '', '***'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.dom.querySelectorAll('.markda-thematic-break')).toHaveLength(3);
    expect(view.dom.querySelectorAll('.markda-h1')).toHaveLength(1);
    expect(view.dom.querySelectorAll('.markda-h2')).toHaveLength(1);
    expect(view.dom.textContent).not.toContain('- - -');
    expect(view.dom.textContent).not.toContain('___');
    expect(view.dom.textContent).not.toContain('***');
  });

  it('collapses blank source lines around a rendered thematic break like Typora', async () => {
    vi.resetModules();
    const text = ['Before', '', '', '___', '', '', 'After'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.dom.querySelector('.markda-thematic-break')).not.toBeNull();
    // The block replacement already consumes the first empty line immediately
    // after the rule; every remaining rendered blank line is explicitly folded.
    expect(view.dom.querySelectorAll('.markda-thematic-blank-line')).toHaveLength(3);

    const blankLine = view.state.doc.line(2);
    view.focus();
    await tick();
    view.dispatch({ selection: { anchor: blankLine.from } });
    await tick();
    expect(view.dom.querySelector('.markda-thematic-break')).not.toBeNull();
    expect(view.domAtPos(blankLine.from).node instanceof Element
      ? (view.domAtPos(blankLine.from).node as Element).closest('.markda-thematic-blank-line')
      : view.domAtPos(blankLine.from).node.parentElement?.closest('.markda-thematic-blank-line')).toBeNull();
  });

  it('exposes thematic-break and task Markdown while their lines are being edited', async () => {
    vi.resetModules();
    const text = ['Before', '', '___', '', '- [ ] Task', '', 'After'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.dom.querySelector('.markda-thematic-break')).not.toBeNull();
    expect(view.dom.querySelector('.markda-task-checkbox')).not.toBeNull();

    view.dom.querySelector<HTMLElement>('.markda-thematic-break')!.click();
    await tick();
    expect(view.state.selection.main.head).toBe(text.indexOf('___'));
    expect(view.dom.querySelector('.markda-thematic-break')).toBeNull();
    expect(view.dom.textContent).toContain('___');

    const taskFrom = text.indexOf('- [ ] Task');
    view.dispatch({ selection: { anchor: taskFrom + 6 } });
    await tick();
    expect(view.dom.querySelector('.markda-task-checkbox')).toBeNull();
    expect(view.dom.textContent).toContain('[ ] Task');

    view.dispatch({ selection: { anchor: text.indexOf('After') } });
    await tick();
    expect(view.dom.querySelector('.markda-thematic-break')).not.toBeNull();
    expect(view.dom.querySelector('.markda-task-checkbox')).not.toBeNull();
  });

  it('renders the remaining supported inline Markdown forms in live view', async () => {
    vi.resetModules();
    setupEditor('_emphasis_ H~2~O x^2^ <https://example.com>');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.dom.querySelector('.markda-emphasis')?.textContent).toBe('emphasis');
    expect(view.dom.querySelector('.markda-subscript')?.textContent).toBe('2');
    expect(view.dom.querySelector('.markda-superscript')?.textContent).toBe('2');
    expect(view.dom.querySelector('.markda-link-text')?.textContent).toBe('https://example.com');
    expect(view.dom.querySelectorAll('.markda-meta')).toHaveLength(8);
  });

  it('directly renders and edits inline images, reference links, and footnotes', async () => {
    vi.resetModules();
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const text = [
      `Before ![pixel](${pixel}) after [guide][docs] with note[^one].`,
      '',
      '[docs]: https://example.com/docs "Documentation"',
      '',
      '[^one]: Original footnote',
      '    continued',
    ].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const image = view.dom.querySelector<HTMLElement>('.markda-inline-image');
    expect(image?.querySelector('img')?.alt).toBe('pixel');
    expect(view.dom.querySelector<HTMLElement>('.markda-link-text')?.dataset.href).toBe('https://example.com/docs');
    expect(view.dom.querySelector('.markda-footnote-reference')?.textContent).toBe('one');
    expect(view.dom.querySelector('.markda-reference-definition')).not.toBeNull();
    expect(view.dom.querySelector('.markda-footnote-definition-content')?.textContent).toBe('Original footnote\ncontinued');
    expect(view.dom.textContent).not.toContain('[docs]:');
    expect(view.dom.textContent).not.toContain('[^one]:');

    image!.click();
    await tick();
    expect(view.state.selection.main.head).toBe(text.indexOf('![pixel]') + 2);
    expect(view.dom.querySelector('.markda-image-alt')?.textContent).toBe('pixel');

    view.dispatch({ selection: { anchor: 0 } });
    await tick();
    const footnote = view.dom.querySelector<HTMLElement>('.markda-footnote-definition-content')!;
    footnote.textContent = 'Updated footnote';
    footnote.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.state.doc.toString()).toContain('[^one]: Updated footnote');
  });

  it('renders shortcut references, bare URLs, entities, escapes, and allowed inline HTML', async () => {
    vi.resetModules();
    const text = [
      'Read [docs] at https://example.com/docs?view=full.',
      'Copyright &copy; and escaped \\*literal\\* with <kbd>Ctrl</kbd>.',
      '',
      '[docs]: https://example.com/reference',
    ].join('\n');
    setupEditor(text);
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { html: boolean }; security: { allowUnsafeHtml: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.html = true;
    initial.settings.security.allowUnsafeHtml = true;
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const links = Array.from(view.dom.querySelectorAll<HTMLElement>('.markda-link-text'));
    expect(links.some((link) => link.textContent === 'docs'
      && link.dataset.href === 'https://example.com/reference')).toBe(true);
    expect(links.some((link) => link.textContent === 'https://example.com/docs?view=full'
      && link.dataset.href === 'https://example.com/docs?view=full')).toBe(true);
    expect(view.dom.querySelector('.markda-entity')?.textContent).toBe('©');
    expect(view.dom.querySelector('.markda-inline-html')?.textContent).toBe('Ctrl');
    const hiddenEscapes = Array.from(view.dom.querySelectorAll<HTMLElement>('.markda-meta'))
      .filter((element) => element.textContent === '\\');
    expect(hiddenEscapes).toHaveLength(2);

    view.dom.querySelector<HTMLElement>('.markda-inline-html')!.click();
    await tick();
    expect(view.dom.textContent).toContain('<kbd>Ctrl</kbd>');
  });

  it('directly edits CommonMark indented code blocks', async () => {
    vi.resetModules();
    setupEditor(['Before', '', '    const value = 1;', '    console.log(value);', '', 'After'].join('\n'));
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const code = view.dom.querySelector<HTMLElement>('.markda-indented-code code[contenteditable]');
    expect(code?.textContent).toBe('const value = 1;\nconsole.log(value);');
    expect(view.dom.textContent).not.toContain('    const value');

    code!.textContent = 'const value = 2;';
    code!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.state.doc.toString()).toContain('    const value = 2;');
  });

  it('directly edits sanitized HTML blocks when HTML is explicitly allowed', async () => {
    vi.resetModules();
    setupEditor(['<div><strong>Hello</strong></div>', '', 'After'].join('\n'));
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { html: boolean }; security: { allowUnsafeHtml: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.html = true;
    initial.settings.security.allowUnsafeHtml = true;
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const html = view.dom.querySelector<HTMLElement>('.markda-html-block-content');
    expect(html?.querySelector('strong')?.textContent).toBe('Hello');
    html!.innerHTML = '<div onclick="alert(1)"><em>Updated</em></div>';
    html!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(view.state.doc.toString()).toContain('<em>Updated</em>');
    expect(view.state.doc.toString()).not.toContain('onclick');
  });

  it('returns selected Markdown and inline math to WYSIWYG after the selection leaves them', async () => {
    vi.resetModules();
    const text = 'Before **bold** and $x^2$ after.';
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.contentDOM.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const boldFrom = text.indexOf('bold');
    view.dispatch({ selection: { anchor: boldFrom, head: boldFrom + 4 } });
    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);

    const mathFrom = text.indexOf('x^2');
    view.dispatch({ selection: { anchor: mathFrom, head: mathFrom + 3 } });
    expect(view.dom.querySelector('.markda-inline-math-source')).not.toBeNull();
    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);

    view.dispatch({ selection: { anchor: text.length } });
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
    expect(view.dom.querySelector('.markda-inline-math-source')).toBeNull();
    expect(view.dom.querySelector('.markda-inline-math')).not.toBeNull();
  });

  it('opens inline math source on a single click', async () => {
    vi.resetModules();
    const text = 'Before $x^2$ after.';
    setupEditor(text);
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { math: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.math = true;
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.dom.querySelector<HTMLElement>('.markda-inline-math')!.click();
    await tick();

    expect(view.state.selection.main.head).toBe(text.indexOf('$') + 1);
    expect(view.dom.querySelector('.markda-inline-math-source')?.textContent).toBe('x^2');
  });

  it('keeps Markdown collapsed when the caret is exactly at a span right edge', async () => {
    vi.resetModules();
    const text = 'Before **bold** after.';
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.dispatch({ selection: { anchor: text.indexOf('** after') + 2 } });
    await tick();

    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
    expect(view.dom.querySelector('.markda-strong')?.textContent).toBe('bold');
  });

  it('exposes a focused heading marker at both line boundaries', async () => {
    vi.resetModules();
    setupEditor('# Support');
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.state.selection.main.head).toBe(0);
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();

    view.focus();
    await tick();
    expect(view.state.selection.main.head).toBe(0);
    expect(view.dom.querySelector('.markda-meta')).not.toBeNull();
    expect(view.dom.querySelector('.markda-meta-expanded')?.textContent).toBe('# ');

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await tick();
    expect(view.dom.querySelector('.markda-meta-expanded')?.textContent).toBe('# ');
  });

  it('uses block focus boundaries for every source-rendered block marker', async () => {
    vi.resetModules();
    const text = ['# Heading', '> Quote', '- Bullet', '1. Ordered', '- [ ] Task', 'Setext', '===', 'Outside'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.focus();
    await tick();
    const cases = [
      { line: 1, selector: '.markda-meta', marker: '# ', occurrence: 0 },
      { line: 2, selector: '.markda-meta', marker: '> ', occurrence: 0 },
      { line: 3, selector: '.markda-list-bullet-source', marker: '-', occurrence: 0 },
      { line: 4, selector: '.markda-list-marker', marker: '1.', occurrence: 0 },
      { line: 5, selector: '.markda-list-bullet-source', marker: '-', occurrence: 1 },
      { line: 6, selector: '.markda-meta', marker: '===', occurrence: 0 },
    ] as const;

    for (const testCase of cases) {
      const line = view.state.doc.line(testCase.line);
      for (const position of [line.from, line.to]) {
        view.dispatch({ selection: { anchor: position } });
        await tick();
        const marker = Array.from(view.dom.querySelectorAll<HTMLElement>(testCase.selector))
          .filter((element) => element.textContent === testCase.marker)[testCase.occurrence];
        expect(marker, `${testCase.marker} at ${position}`).not.toBeUndefined();
        expect(marker?.classList.contains('markda-meta-expanded'), `${testCase.marker} at ${position}`).toBe(true);
      }
    }

    view.dispatch({ selection: { anchor: view.state.doc.line(8).from } });
    await tick();
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
  });

  it.each([
    ['strong', '**bold**', 2],
    ['underscore strong', '__bold__', 2],
    ['asterisk emphasis', '*italic*', 1],
    ['underscore emphasis', '_italic_', 1],
    ['strikethrough', '~~strike~~', 2],
    ['subscript', '~sub~', 1],
    ['superscript', '^sup^', 1],
    ['highlight', '==mark==', 2],
    ['inline code', '`code`', 1],
    ['link', '[label](https://example.com)', 1],
    ['autolink', '<https://example.com>', 1],
    ['inline math', '$x^2$', 1],
  ])('keeps %s syntax collapsed at its right edge and expands it inside', async (_name, source, openingLength) => {
    vi.resetModules();
    setupEditor(`${source} outside`);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    view.focus();
    view.dispatch({ selection: { anchor: source.length } });
    await tick();
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();

    view.dispatch({ selection: { anchor: openingLength + 1 } });
    await tick();
    expect(view.dom.querySelector('.markda-meta-expanded')).not.toBeNull();
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
    const view = __getEditorView();
    view.focus();
    await tick();
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

  it('adds an editable paragraph after a terminal block widget', async () => {
    vi.resetModules();
    const text = ['$$', 'x^2', '$$'].join('\n');
    setupEditor(text);
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    const target = view.dom.querySelector<HTMLElement>('.markda-trailing-paragraph');
    expect(target).not.toBeNull();

    target!.click();
    await tick();

    expect(view.state.doc.toString()).toBe(`${text}\n\n`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(view.dom.querySelector('.markda-trailing-paragraph')).toBeNull();
  });

  it('renders single-line display math without exposing outer dollar signs', async () => {
    vi.resetModules();
    const text = ['Before math.', '', '$$J(\\theta) = x^2$$', '', 'After math.'].join('\n');
    setupEditor(text);
    const initial = (globalThis as typeof globalThis & {
      __markdaInitial: { settings: { markdown: { math: boolean } } };
    }).__markdaInitial;
    initial.settings.markdown.math = true;
    const { __getEditorView } = await import('../src/webview/main.js');
    await tick();

    const view = __getEditorView();
    expect(view.dom.querySelector('.markda-block-math')).not.toBeNull();
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
    rendered.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    rendered.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
