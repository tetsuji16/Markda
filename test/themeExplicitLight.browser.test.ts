/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

describe('explicit light theme with a dark VS Code host', () => {
  it('keeps code and editable math/Mermaid fields light and writable', async () => {
    document.body.className = 'vscode-dark';
    for (const [name, value] of Object.entries({
      '--vscode-editor-foreground': '#d4d4d4', '--vscode-editor-background': '#1e1e1e',
      '--vscode-editor-selectionBackground': '#264f78', '--vscode-input-foreground': '#cccccc',
      '--vscode-input-background': '#3c3c3c', '--vscode-input-border': '#555555',
      '--vscode-textCodeBlock-background': '#2d2d2d', '--vscode-textPreformat-foreground': '#eeeeee',
    })) document.documentElement.style.setProperty(name, value);
    document.head.insertAdjacentHTML('beforeend', '<style>code{background-color:var(--vscode-textCodeBlock-background);color:var(--vscode-textPreformat-foreground)}</style>');
    const text = [
      'Use `inline code` and $x^2$.', '',
      '```javascript', 'const value = "light";', '```', '',
      '$$', 'y^2', '$$', '', '```mermaid', 'graph TD; A-->B', '```',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///theme-fields.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text,
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 0, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: true, diagrams: true, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage: vi.fn() }));

    const { __getEditorView } = await import('../src/webview/main.js');
    const view = __getEditorView();
    const inline = view.dom.querySelector<HTMLElement>('.markda-code')!;
    const code = view.dom.querySelector<HTMLElement>('.markda-live-code code[contenteditable="true"]')!;
    const keyword = code.querySelector<HTMLElement>('.markda-syntax-keyword')!;
    const string = code.querySelector<HTMLElement>('.markda-syntax-string')!;
    expect(document.documentElement.dataset.markdaColorMode).toBe('light');
    expect(getComputedStyle(inline).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(inline).backgroundColor).toBe('rgb(243, 244, 244)');
    expect(getComputedStyle(code).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(code).backgroundColor).toBe('rgb(248, 248, 248)');
    expect(getComputedStyle(code.closest('pre')!).backgroundColor).toBe('rgb(248, 248, 248)');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light');
    expect(getComputedStyle(keyword).color).toBe('rgb(207, 34, 46)');
    expect(getComputedStyle(string).color).toBe('rgb(10, 48, 105)');
    expect(getComputedStyle(code, '::selection').backgroundColor).toBe('rgb(181, 214, 252)');
    code.textContent = 'const value = "bright";';
    code.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    code.blur();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.state.doc.toString()).toContain('bright');

    const math = view.dom.querySelector<HTMLElement>('.markda-block-math')!;
    await vi.waitUntil(() => math.querySelector('.katex') !== null, { timeout: 5_000 });
    math.click();
    const mathSource = math.parentElement!.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')!;
    expect(mathSource.hidden).toBe(false);
    expect(getComputedStyle(mathSource).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(mathSource).backgroundColor).toBe('rgb(248, 248, 248)');
    mathSource.focus();
    mathSource.setSelectionRange(0, mathSource.value.length);
    mathSource.value = 'z^3';
    mathSource.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    mathSource.blur();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.state.doc.toString()).toContain('z^3');

    const diagram = view.dom.querySelector<HTMLElement>('[data-markda-renderer="mermaid"]')!;
    await vi.waitUntil(() => diagram.querySelector('svg') !== null, { timeout: 15_000 });
    diagram.click();
    const diagramSource = diagram.parentElement!.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')!;
    expect(diagramSource.hidden).toBe(false);
    expect(getComputedStyle(diagramSource).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(diagramSource).backgroundColor).toBe('rgb(248, 248, 248)');
    diagramSource.value = 'graph TD; A-->C';
    diagramSource.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    diagramSource.blur();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.state.doc.toString()).toContain('A-->C');

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.documentElement.dataset.markdaColorMode).toBe('dark');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('dark');
    const darkCode = document.querySelector<HTMLElement>('.markda-live-code code[contenteditable="true"]')!;
    expect(getComputedStyle(darkCode).color).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(darkCode).backgroundColor).toBe('rgb(37, 37, 38)');
  });
});
