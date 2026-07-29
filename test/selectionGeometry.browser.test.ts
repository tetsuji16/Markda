/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('rendered Markdown selection geometry in Chromium', () => {
  it('does not fill the vertical margins between selected blocks', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const text = [
      '- **Bold**, *italic*, ~~strikethrough~~, and `inline code`',
      '- [x] Completed task',
      '- [ ] Incomplete task',
      '- [OpenAI](https://openai.com/)',
      '',
      '> This block quote verifies rendered quote styling.',
      '',
      '## Table',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///selection.md',
      resourceBaseUri: 'http://localhost/',
      themeBaseUri: '',
      version: 1,
      text,
      settings: {
        contentWidth: 860,
        autoPairMarkdown: true,
        typewriterKeepCentered: true,
        previewUpdateDelay: 500,
        liveTableMaxCells: 600,
        themeMode: 'light',
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
    await settle();
    const view = __getEditorView();
    view.dispatch({ selection: { anchor: 2, head: text.indexOf('Table') + 3 } });
    await settle();

    const defaultLayer = view.dom.querySelector<HTMLElement>('.cm-selectionLayer')!;
    expect(getComputedStyle(defaultLayer).display).toBe('none');

    const selectedRects = Array.from(
      view.dom.querySelectorAll<HTMLElement>('.markda-compactSelectionLayer .cm-selectionBackground'),
    ).map((element) => element.getBoundingClientRect());
    const tallestRenderedLine = Math.max(
      ...Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-line'))
        .map((element) => element.getBoundingClientRect().height),
    );
    expect(selectedRects.length).toBeGreaterThan(4);
    expect(Math.max(...selectedRects.map((rect) => rect.height)))
      .toBeLessThanOrEqual(tallestRenderedLine + 1);
  });
});
