// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' })),
}));

vi.mock('../src/webview/mermaidLoader.js', () => ({ api: mermaid }));

function initialize(themeMode: 'auto' | 'light' | 'dark', text = '# Theme'): ReturnType<typeof vi.fn> {
  document.body.className = 'vscode-dark';
  (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
    type: 'initialize', uri: 'file:///theme.md', resourceBaseUri: 'file:///', themeBaseUri: 'data:text/css,',
    version: 1, text,
    settings: {
      contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
      previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode,
      markdown: { math: false, diagrams: true, html: false, breaks: false },
      theme: { light: 'paper', dark: 'midnight' },
      security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
    },
  };
  const postMessage = vi.fn();
  vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage }));
  return postMessage;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Markda color themes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial;
    document.documentElement.removeAttribute('data-markda-color-mode');
    document.documentElement.removeAttribute('style');
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('uses a complete light palette even while VS Code is dark, then switches every surface to dark', async () => {
    const postMessage = initialize('light');
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();

    const root = document.documentElement;
    const styleText = document.body.querySelector('style')?.textContent ?? '';
    expect(root.dataset.markdaColorMode).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(styleText).toContain('--markda-scrollbar-thumb');
    expect(styleText).toContain('*::-webkit-scrollbar-thumb:hover');
    const remainingVsCodeVariables = Array.from(styleText.matchAll(/var\((--vscode-[\w-]+)/gu), (match) => match[1]);
    expect(remainingVsCodeVariables.every((name) => name?.includes('-font-'))).toBe(true);

    const before = __getEditorView().state;
    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();

    expect(root.dataset.markdaColorMode).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(__getEditorView().state).not.toBe(before);
    expect(postMessage).toHaveBeenCalledWith({ type: 'updateThemeMode', mode: 'dark' });
  });

  it('renders and re-renders Mermaid with the effective Markda theme', async () => {
    initialize('light', ['```mermaid', 'graph TD; A-->B', '```'].join('\n'));
    await import('../src/webview/main.js');
    await settle();

    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      theme: 'default',
      htmlLabels: false,
    }));
    const lightRenderCount = mermaid.render.mock.calls.length;
    // Happy DOM may discard CodeMirror block widgets after its zero-sized
    // viewport is measured. Keep a connected live-diagram surface to verify the
    // same theme-refresh path used by the real widget.
    const liveDiagram = document.createElement('div');
    liveDiagram.dataset.markdaRenderer = 'mermaid';
    liveDiagram.dataset.markdaSource = 'graph TD; A-->B';
    document.body.append(liveDiagram);

    const initializeCount = mermaid.initialize.mock.calls.length;
    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();

    expect(document.documentElement.dataset.markdaColorMode).toBe('dark');
    const refreshedConfigurations = mermaid.initialize.mock.calls.slice(initializeCount).map(([configuration]) => configuration);
    expect(refreshedConfigurations).toContainEqual(expect.objectContaining({
      theme: 'dark',
      themeVariables: expect.objectContaining({ primaryTextColor: '#d4d4d4', mainBkg: '#2d2d30' }),
    }));
    expect(mermaid.render.mock.calls.length).toBeGreaterThan(lightRenderCount);
  });
});
