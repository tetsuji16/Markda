// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('large-document startup performance', { timeout: 10_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial;
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('initializes a 20,000-line hard-wrapped document within the startup budget', async () => {
    const text = Array.from({ length: 20_000 }, (_value, index) => `hard wrapped prose line ${index}`).join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///large.md',
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
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined,
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    const started = performance.now();
    const { __getEditorView } = await import('../src/webview/main.js');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const elapsed = performance.now() - started;

    expect(__getEditorView().state.doc.lines).toBe(20_000);
    expect(elapsed).toBeLessThan(5_000);
  });
});
