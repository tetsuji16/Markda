/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function settle(delay = 0): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
}

async function waitForElement(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const element = document.querySelector(selector);
    if (element) return element;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

describe('complete supported Markdown live editing in Chromium', () => {
  it('renders and directly edits references, footnotes, indented code, entities, and HTML', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const text = [
      `Inline ![pixel](${pixel}), [guide][docs], note[^one], &copy;, and <kbd>Ctrl</kbd>.`,
      '',
      '    const answer = 41;',
      '',
      '<div><strong>HTML block</strong></div>',
      '',
      '[docs]: https://example.com/docs "Docs"',
      '',
      '[^one]: Footnote body',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///coverage.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text,
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: true, diagrams: true, html: true, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: true },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined, setState: vi.fn(), postMessage: vi.fn(),
    }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    await waitForElement('.markda-indented-code');
    expect(view.dom.querySelector('.markda-inline-image img')?.getAttribute('alt')).toBe('pixel');
    expect(view.dom.querySelector<HTMLElement>('.markda-link-text')?.dataset.href).toBe('https://example.com/docs');
    expect(view.dom.querySelector('.markda-footnote-reference')?.textContent).toBe('one');
    expect(view.dom.querySelector('.markda-entity')?.textContent).toBe('©');
    expect(view.dom.querySelector('.markda-inline-html kbd')?.textContent).toBe('Ctrl');
    expect(view.dom.querySelector('.markda-indented-code code')?.textContent).toBe('const answer = 41;');
    expect(view.dom.querySelector('.markda-html-block strong')?.textContent).toBe('HTML block');
    expect(view.dom.querySelector('.markda-reference-definition')).not.toBeNull();

    const footnote = view.dom.querySelector<HTMLElement>('.markda-footnote-definition-content')!;
    footnote.focus();
    footnote.textContent = 'Edited footnote';
    footnote.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await settle(120);
    expect(view.state.doc.toString()).toContain('[^one]: Edited footnote');

    const html = view.dom.querySelector<HTMLElement>('.markda-html-block')!;
    html.focus();
    html.innerHTML = '<em onclick="alert(1)">Edited HTML</em>';
    html.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await settle(140);
    expect(view.state.doc.toString()).toContain('<em>Edited HTML</em>');
    expect(view.state.doc.toString()).not.toContain('onclick');
  });
});
