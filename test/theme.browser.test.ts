/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Markda theme colors in Chromium', () => {
  it('keeps surfaces, text, and native scrollbars on the selected color mode', async () => {
    document.body.className = 'vscode-dark';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///theme-browser.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text: [
        '# Theme', '', '> Quoted text', '', 'Use `inline code`.', '',
        '| Item | Value |', '| --- | --- |', '| Theme | Use `Ctrl+/` |', '',
        '```javascript', "const greeting = 'Hello, markda!';", 'console.log(greeting);', '```',
      ].join('\n'),
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: false, diagrams: false, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage: vi.fn() }));

    await import('../src/webview/main.js');
    await settle();

    const root = document.documentElement;
    const quote = document.querySelector<HTMLElement>('.markda-quote')!;
    const inlineCode = document.querySelector<HTMLElement>('.markda-code')!;
    const blockCode = document.querySelector<HTMLElement>('.markda-live-code code')!;
    const activeLine = document.querySelector<HTMLElement>('.cm-activeLine')!;
    const tableCode = document.querySelector<HTMLElement>('.markda-live-table-wrap code')!;
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    expect(root.dataset.markdaColorMode).toBe('light');
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(document.body).color).toBe('rgb(26, 26, 26)');
    expect(getComputedStyle(quote).color).toBe('rgb(87, 96, 106)');
    expect(getComputedStyle(inlineCode).backgroundColor).toBe('rgb(246, 248, 250)');
    expect(getComputedStyle(blockCode).color).toBe('rgb(26, 26, 26)');
    expect(tableCode.textContent).toBe('Ctrl+/');
    expect(tableCode.closest('td')?.textContent).toBe('Use Ctrl+/');
    expect(getComputedStyle(tableCode).backgroundColor).toBe('rgb(246, 248, 250)');
    expect(getComputedStyle(activeLine).backgroundColor).not.toBe('rgb(34, 34, 34)');
    expect(getComputedStyle(scroller).scrollbarColor).toContain('rgba(31, 35, 40, 0.28)');
    const lightTypography = {
      fontFamily: getComputedStyle(content).fontFamily,
      fontSize: getComputedStyle(content).fontSize,
      letterSpacing: getComputedStyle(content).letterSpacing,
      lineHeight: getComputedStyle(content).lineHeight,
    };

    const tableCell = tableCode.closest<HTMLElement>('td')!;
    tableCell.focus();
    expect(tableCell.textContent).toBe('Use `Ctrl+/`');
    expect(tableCell.querySelector('code')).toBeNull();
    tableCell.blur();
    await settle();
    expect(tableCell.querySelector('code')?.textContent).toBe('Ctrl+/');

    document.querySelector<HTMLButtonElement>('#preview-button')!.click();
    await settle();
    const renderedQuote = document.querySelector<HTMLElement>('#preview blockquote')!;
    const renderedInlineCode = document.querySelector<HTMLElement>('#preview :not(pre) > code')!;
    const renderedTable = document.querySelector<HTMLElement>('#preview table')!;
    expect(getComputedStyle(renderedQuote).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(renderedQuote).color).toBe('rgb(87, 96, 106)');
    expect(getComputedStyle(renderedInlineCode).color).toBe('rgb(26, 26, 26)');
    expect(getComputedStyle(renderedInlineCode).backgroundColor).toBe('rgb(246, 248, 250)');
    expect(getComputedStyle(renderedTable).backgroundColor).toBe('rgb(255, 255, 255)');

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();

    expect(root.dataset.markdaColorMode).toBe('dark');
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(30, 30, 30)');
    expect(getComputedStyle(document.body).color).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(quote).color).toBe('rgb(168, 168, 168)');
    expect(getComputedStyle(inlineCode).backgroundColor).toBe('rgb(37, 37, 38)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('.markda-live-code code')!).color).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('.markda-live-table-wrap code')!).backgroundColor).toBe('rgb(37, 37, 38)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('#preview :not(pre) > code')!).color).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('#preview :not(pre) > code')!).backgroundColor).toBe('rgb(37, 37, 38)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('#preview table')!).backgroundColor).toBe('rgb(30, 30, 30)');
    expect(getComputedStyle(scroller).scrollbarColor).toContain('rgba(200, 200, 200, 0.4)');
    expect({
      fontFamily: getComputedStyle(content).fontFamily,
      fontSize: getComputedStyle(content).fontSize,
      letterSpacing: getComputedStyle(content).letterSpacing,
      lineHeight: getComputedStyle(content).lineHeight,
    }).toEqual(lightTypography);

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();
    expect(root.dataset.markdaColorMode).toBe('light');
    expect(getComputedStyle(document.querySelector<HTMLElement>('.markda-live-code code')!).color).toBe('rgb(26, 26, 26)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('#preview pre code')!).color).toBe('rgb(26, 26, 26)');
  });
});
