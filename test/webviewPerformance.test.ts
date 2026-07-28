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
    // Vitest runs files in parallel, so leave headroom for CPU contention while
    // retaining a firm guard against synchronous large-document startup stalls.
    expect(elapsed).toBeLessThan(7_500);
  });

  it('keeps cursor movement in a 20,000-line document off the full-document analysis path', async () => {
    const text = Array.from(
      { length: 20_000 },
      (_value, index) => `${index % 100 === 0 ? '## Section ' : ''}hard wrapped prose line ${index}`,
    ).join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///large-selection.md',
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

    const { __getEditorView } = await import('../src/webview/main.js');
    const editor = __getEditorView();
    const started = performance.now();
    for (let index = 1; index <= 100; index++) {
      editor.dispatch({ selection: { anchor: Math.floor(editor.state.doc.length * index / 101) } });
    }
    const elapsed = performance.now() - started;

    // The former full-document scan on every selection is far beyond this even
    // with worker contention; the cached path remains comfortably inside it.
    expect(elapsed).toBeLessThan(2_500);
    expect(document.querySelector('#document-section-status')?.textContent).toContain('Section');
  });
});
