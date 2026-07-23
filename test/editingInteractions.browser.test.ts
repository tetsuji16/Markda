/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('rendered math and Mermaid editing in Chromium', () => {
  it('opens rendered sources with one click and keeps the active editor stable on save', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const text = [
      'Inline $x^2$ math.',
      '',
      '$$',
      'y^2',
      '$$',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n');
    const postMessage = vi.fn();
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///editing.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text,
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: true, diagrams: true, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();

    view.dom.querySelector<HTMLElement>('.markda-inline-math')!.click();
    await settle();
    expect(view.state.selection.main.head).toBe(text.indexOf('$') + 1);
    expect(view.dom.querySelector('.markda-inline-math-source')?.textContent).toBe('x^2');

    view.dispatch({ selection: { anchor: 0 } });
    await settle();
    view.dom.querySelector<HTMLElement>('.markda-block-math')!.click();
    const blockSource = view.dom.querySelector<HTMLTextAreaElement>('.markda-block-math-wrap .markda-block-source-editor')!;
    expect(blockSource.hidden).toBe(false);

    view.contentDOM.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    const mermaid = view.dom.querySelector<HTMLElement>('[data-markda-renderer="mermaid"]')!;
    mermaid.click();
    const mermaidSource = mermaid.parentElement!.querySelector<HTMLTextAreaElement>('.markda-block-source-editor')!;
    expect(mermaidSource.hidden).toBe(false);
    expect(document.activeElement).toBe(mermaidSource);

    mermaidSource.value = 'graph TD; A-->C';
    mermaidSource.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    const scrollTop = view.scrollDOM.scrollTop;
    mermaidSource.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    await settle();

    expect(mermaidSource.hidden).toBe(false);
    expect(document.activeElement).toBe(mermaidSource);
    expect(view.scrollDOM.scrollTop).toBe(scrollTop);
    expect(view.state.doc.toString()).toContain('A-->C');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'save', text: expect.stringContaining('A-->C'),
    }));
  });
});
