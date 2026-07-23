/// <reference types="@vitest/browser/providers/playwright" />

import { userEvent } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

describe('Typora-style delimiter pairing in Chromium', () => {
  it('moves through an automatic closer and deletes an empty pair as one unit', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///pairing.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text: '',
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: true, diagrams: false, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined, setState: vi.fn(), postMessage: vi.fn(),
    }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    await userEvent.click(view.contentDOM);

    await userEvent.keyboard('[[');
    expect(view.state.doc.toString()).toBe('[]');
    expect(view.state.selection.main.head).toBe(1);

    await userEvent.keyboard(']');
    expect(view.state.doc.toString()).toBe('[]');
    expect(view.state.selection.main.head).toBe(2);

    view.dispatch({ selection: { anchor: 1 } });
    await userEvent.keyboard('{Backspace}');
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
  });
});
