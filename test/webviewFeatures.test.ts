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
});
