/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live table toolbar in Chromium', () => {
  it('appears for the focused table and edits relative to the active cell', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///table-toolbar.md',
      resourceBaseUri: 'http://localhost/',
      themeBaseUri: 'http://localhost/',
      version: 1,
      text: ['Before', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '## After'].join('\n'),
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
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined,
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    await import('../src/webview/main.js');
    await settle();

    const toolbar = document.querySelector<HTMLElement>('#table-toolbar')!;
    expect(getComputedStyle(toolbar).display).toBe('none');
    expect(document.querySelector('.markda-inline-table-controls')).toBeNull();

    const followingHeading = document.querySelector<HTMLElement>('.markda-h2')!;
    const followingHeadingTop = followingHeading.getBoundingClientRect().top;
    document.querySelector<HTMLElement>('[data-table-row="0"][data-table-column="0"]')!.focus();
    await settle();
    expect(getComputedStyle(toolbar).display).toBe('flex');
    expect(followingHeading.getBoundingClientRect().top).toBeCloseTo(followingHeadingTop, 0);

    const rowAfter = document.querySelector<HTMLButtonElement>('[data-table-command="row-after"]')!;
    rowAfter.focus();
    rowAfter.click();
    await settle();
    expect(document.querySelectorAll('.markda-live-table-wrap tr')).toHaveLength(3);
    expect(document.activeElement?.matches('[data-table-row="1"][data-table-column="0"]')).toBe(true);

    const columnRight = document.querySelector<HTMLButtonElement>('[data-table-command="column-right"]')!;
    columnRight.focus();
    columnRight.click();
    await settle();
    expect(document.querySelectorAll('.markda-live-table-wrap th')).toHaveLength(3);
    expect(document.activeElement?.matches('[data-table-row="1"][data-table-column="1"]')).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-command="toggleBold"]')!.focus();
    await settle();
    expect(getComputedStyle(toolbar).display).toBe('none');
  });
});
