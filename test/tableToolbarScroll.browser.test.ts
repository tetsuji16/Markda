/// <reference types="@vitest/browser/providers/playwright" />

import { afterEach, describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('table toolbar layout stability in Chromium', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the document in place when the table toolbar appears and disappears', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const paragraphs = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}`).join('\n\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///table-toolbar-scroll.md',
      resourceBaseUri: 'http://localhost/',
      themeBaseUri: 'http://localhost/',
      version: 1,
      text: ['# Board', '', 'Intro', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', paragraphs].join('\n'),
      settings: {
        contentWidth: 520,
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
    vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage: vi.fn() }));

    await import('../src/webview/main.js');
    await settle();

    const shell = document.querySelector<HTMLElement>('.markda-shell')!;
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    scroller.scrollTop = 40;
    await settle();
    const tableTop = () => document.querySelector('table')!.getBoundingClientRect().top;
    expect(shell.classList.contains('table-active')).toBe(false);
    const before = tableTop();

    const cell = document.querySelectorAll<HTMLElement>('td')[0]!;
    cell.focus();
    cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(shell.classList.contains('table-active')).toBe(true);
    expect(Math.abs(tableTop() - before)).toBeLessThanOrEqual(1);

    document.querySelector<HTMLElement>('.cm-content')!.focus();
    await settle();
    expect(shell.classList.contains('table-active')).toBe(false);
    expect(Math.abs(tableTop() - before)).toBeLessThanOrEqual(1);
  });
});
