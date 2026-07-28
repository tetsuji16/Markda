// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('live Markdown webview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial;
    document.body.innerHTML = '';
  });

  it('renders inline Markdown instead of exposing its source syntax', async () => {
    const text = [
      '# Support',
      '',
      '<p align="center">',
      '  <img src="resources/icon.png" width="128" height="128" alt="Project icon" onerror="alert(1)">',
      '  <script type="application/json">{"unsafe":true}</script>',
      '</p>',
      '',
      'Use **Output** and open [GitHub Issues](https://example.com/issues).',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///support.md', resourceBaseUri: 'file:///', themeBaseUri: 'data:text/css,',
      locale: 'ja', direction: 'ltr', version: 1, text,
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600,
        markdown: { math: false, diagrams: false, html: true, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined,
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    await import('../src/webview/main.js');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const editor = document.querySelector<HTMLElement>('#editor')!;
    expect(editor.querySelector('.markda-strong')?.textContent).toBe('Output');
    expect(editor.querySelector('.markda-link-text')?.textContent).toBe('GitHub Issues');
    expect(editor.querySelectorAll('.markda-meta')).toHaveLength(5);
    const htmlBlock = editor.querySelector<HTMLElement>('.markda-html-block')!;
    const htmlContent = htmlBlock.querySelector<HTMLElement>('.markda-html-block-content')!;
    const htmlImage = htmlBlock.querySelector<HTMLImageElement>('img')!;
    expect(htmlBlock.getAttribute('contenteditable')).toBe('false');
    expect(htmlContent.getAttribute('contenteditable')).toBe('false');
    expect(htmlImage.getAttribute('src')).toBe('file:///resources/icon.png');
    expect(htmlImage.getAttribute('width')).toBe('128');
    expect(htmlImage.hasAttribute('onerror')).toBe(false);
    expect(htmlBlock.querySelector('script')).toBeNull();
    expect(htmlBlock.textContent).not.toContain('<p align=');
    // A logical CodeMirror selection exists before the editor is focused, but
    // it must not expose Markdown source syntax on initial render.
    expect(editor.querySelectorAll('.markda-meta-expanded')).toHaveLength(0);
    expect(document.querySelector('[data-command="insertTable"]')?.getAttribute('title')).toBe('表を挿入');
    expect(document.querySelector('#table-dialog-title')?.textContent).toBe('表を挿入');
  });
});
