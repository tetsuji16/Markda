/// <reference types="@vitest/browser/providers/playwright" />

import { page } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live table toolbar in Chromium', () => {
  afterEach(async () => {
    await page.viewport(900, 700);
  });

  it('appears for the focused table and edits relative to the active cell', async () => {
    await page.viewport(1400, 700);
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

    const editorToolbar = document.querySelector<HTMLElement>('#editor-toolbar')!;
    expect(document.querySelector('#toolbar-toggle')).toBeNull();
    expect(getComputedStyle(editorToolbar).flexWrap).toBe('nowrap');
    expect(getComputedStyle(editorToolbar).overflowX).toBe('visible');
    const wideActions = editorToolbar.querySelectorAll<HTMLElement>('.markda-toolbar-wide');
    expect(wideActions).toHaveLength(6);
    expect(Array.from(wideActions).every((action) => getComputedStyle(action).display === 'flex')).toBe(true);
    expect(editorToolbar.scrollWidth).toBeLessThanOrEqual(editorToolbar.clientWidth);
    await page.viewport(900, 700);
    await settle();
    expect(Array.from(wideActions).every((action) => getComputedStyle(action).display === 'none')).toBe(true);
    expect(editorToolbar.scrollWidth).toBeLessThanOrEqual(editorToolbar.clientWidth);
    const firstLine = document.querySelector<HTMLElement>('.cm-line')!;
    expect(firstLine.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(editorToolbar.getBoundingClientRect().bottom);

    const toolbar = document.querySelector<HTMLElement>('#table-toolbar')!;
    expect(getComputedStyle(toolbar).display).toBe('none');
    expect(document.querySelector('.markda-inline-table-controls')).toBeNull();

    const followingHeading = document.querySelector<HTMLElement>('.markda-h2')!;
    const followingHeadingTop = followingHeading.getBoundingClientRect().top;
    document.querySelector<HTMLElement>('[data-table-row="0"][data-table-column="0"]')!.focus();
    await settle();
    expect(getComputedStyle(toolbar).display).toBe('flex');
    expect(getComputedStyle(toolbar).flexWrap).toBe('wrap');
    expect(getComputedStyle(toolbar).overflowX).toBe('hidden');
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    expect(followingHeading.getBoundingClientRect().top).toBeGreaterThan(followingHeadingTop);
    expect(firstLine.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom);

    const rowAfter = document.querySelector<HTMLButtonElement>('[data-table-command="row-after"]')!;
    const rowAfterRect = rowAfter.getBoundingClientRect();
    const rowAfterTarget = document.elementFromPoint(
      rowAfterRect.left + rowAfterRect.width / 2,
      rowAfterRect.top + rowAfterRect.height / 2,
    );
    expect(rowAfterTarget?.closest('[data-table-command="row-after"]')).toBe(rowAfter);
    rowAfter.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: rowAfterRect.left + rowAfterRect.width / 2,
      clientY: rowAfterRect.top + rowAfterRect.height / 2,
    }));
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
