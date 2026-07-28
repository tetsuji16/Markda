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
        '| Item | Value |', '| --- | --- |', '| Theme | Use `Ctrl+/` |', '| Mode | Light |', '',
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
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => ({
        schemaVersion: 2, sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: true,
      }),
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    await import('../src/webview/main.js');
    await settle();

    const root = document.documentElement;
    const quote = document.querySelector<HTMLElement>('.markda-quote')!;
    const inlineCode = document.querySelector<HTMLElement>('.markda-code')!;
    const blockCode = document.querySelector<HTMLElement>('.markda-live-code code')!;
    const blockKeyword = blockCode.querySelector<HTMLElement>('.markda-syntax-keyword')!;
    const blockString = blockCode.querySelector<HTMLElement>('.markda-syntax-string')!;
    const blockPre = blockCode.closest<HTMLElement>('pre')!;
    const blockFrame = blockPre.closest<HTMLElement>('.markda-fenced-code')!;
    const blockToolbar = blockFrame.querySelector<HTMLElement>('.markda-code-toolbar')!;
    const activeLine = document.querySelector<HTMLElement>('.cm-activeLine')!;
    const tableCode = document.querySelector<HTMLElement>('.markda-live-table-wrap code')!;
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    const line = document.querySelector<HTMLElement>('.cm-line')!;
    expect(root.dataset.markdaColorMode).toBe('light');
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(document.body).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(quote).color).toBe('rgb(119, 119, 119)');
    expect(getComputedStyle(inlineCode).backgroundColor).toBe('rgb(243, 244, 244)');
    expect(getComputedStyle(blockCode).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(blockPre).backgroundColor).toBe('rgb(248, 248, 248)');
    expect(getComputedStyle(blockFrame).borderRadius).toBe('4px');
    expect(getComputedStyle(blockFrame).borderTopWidth).toBe('1px');
    expect(getComputedStyle(blockToolbar).borderBottomWidth).toBe('1px');
    expect(getComputedStyle(blockPre).borderTopWidth).toBe('0px');
    expect(getComputedStyle(blockKeyword).color).toBe('rgb(207, 34, 46)');
    expect(getComputedStyle(blockString).color).toBe('rgb(10, 48, 105)');
    expect(tableCode.textContent).toBe('Ctrl+/');
    expect(tableCode.closest('td')?.textContent).toBe('Use Ctrl+/');
    expect(getComputedStyle(tableCode).backgroundColor).toBe('rgb(243, 244, 244)');
    const liveTable = document.querySelector<HTMLElement>('.markda-live-table-wrap table')!;
    const liveHeader = liveTable.querySelector<HTMLElement>('th')!;
    const liveRows = liveTable.querySelectorAll<HTMLElement>('tbody tr');
    expect(liveRows).toHaveLength(2);
    expect(getComputedStyle(liveHeader).backgroundColor).toBe('rgb(248, 248, 248)');
    expect(getComputedStyle(liveRows[0]!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(liveRows[1]!).backgroundColor).toBe('rgb(248, 248, 248)');
    expect(getComputedStyle(activeLine).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(scroller).scrollbarColor).toContain('rgba(31, 35, 40, 0.28)');
    expect(getComputedStyle(scroller).fontFamily).toContain('Open Sans');
    expect(getComputedStyle(scroller).lineHeight).toBe('25.6px');
    expect(getComputedStyle(content).fontSize).toBe('16px');
    expect(getComputedStyle(content).lineHeight).toBe('25.6px');
    expect(getComputedStyle(content).fontFamily).toContain('Open Sans');
    expect(getComputedStyle(content).marginLeft).toBe(getComputedStyle(content).marginRight);
    expect(getComputedStyle(line).padding).toBe('0px');
    const lightTypography = {
      fontFamily: getComputedStyle(content).fontFamily,
      fontSize: getComputedStyle(content).fontSize,
      letterSpacing: getComputedStyle(content).letterSpacing,
      lineHeight: getComputedStyle(content).lineHeight,
    };

    const tableCell = tableCode.closest<HTMLElement>('td')!;
    tableCell.focus();
    expect(getComputedStyle(tableCell).outlineStyle).toBe('none');
    expect(getComputedStyle(tableCell).boxShadow).toBe('rgb(9, 105, 218) 0px 0px 0px 2px inset');
    expect(tableCell.textContent).toBe('Use `Ctrl+/`');
    expect(tableCell.querySelector('code')).toBeNull();
    tableCell.blur();
    await settle();
    expect(tableCell.querySelector('code')?.textContent).toBe('Ctrl+/');

    expect(document.querySelector('#preview-button')).toBeNull();
    const renderedQuote = document.querySelector<HTMLElement>('#preview blockquote')!;
    const renderedInlineCode = document.querySelector<HTMLElement>('#preview :not(pre) > code')!;
    const renderedTable = document.querySelector<HTMLElement>('#preview table')!;
    expect(getComputedStyle(renderedQuote).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(renderedQuote).color).toBe('rgb(119, 119, 119)');
    expect(getComputedStyle(renderedInlineCode).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(renderedInlineCode).backgroundColor).toBe('rgb(243, 244, 244)');
    expect(getComputedStyle(renderedTable).backgroundColor).toBe('rgb(255, 255, 255)');

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();

    expect(root.dataset.markdaColorMode).toBe('dark');
    expect(document.querySelector('.markda-live-code code')).toBe(blockCode);
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(30, 30, 30)');
    expect(getComputedStyle(document.body).color).toBe('rgb(212, 212, 212)');
    content.focus();
    await settle();
    const cursor = document.querySelector<HTMLElement>('.cm-cursor')!;
    expect(getComputedStyle(cursor).borderLeftColor).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(cursor).borderLeftWidth).toBe('2px');
    expect(getComputedStyle(cursor).marginLeft).toBe('-1px');
    expect(getComputedStyle(cursor).boxShadow).toBe('none');
    expect(getComputedStyle(activeLine).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    const selectionSample = document.createElement('span');
    selectionSample.className = 'cm-selectionBackground';
    content.append(selectionSample);
    expect(getComputedStyle(selectionSample).backgroundColor).toBe('rgb(74, 137, 220)');
    selectionSample.remove();
    expect(getComputedStyle(quote).color).toBe('rgb(168, 168, 168)');
    expect(getComputedStyle(inlineCode).backgroundColor).toBe('rgb(37, 37, 38)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('.markda-live-code code')!).color).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(blockPre).backgroundColor).toBe('rgb(37, 37, 38)');
    expect(getComputedStyle(blockKeyword).color).toBe('rgb(255, 123, 114)');
    expect(getComputedStyle(blockString).color).toBe('rgb(165, 214, 255)');
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
    expect(document.querySelector('.markda-live-code code')).toBe(blockCode);
    expect(getComputedStyle(document.querySelector<HTMLElement>('.markda-live-code code')!).color).toBe('rgb(51, 51, 51)');
    expect(getComputedStyle(blockPre).backgroundColor).toBe('rgb(248, 248, 248)');
    expect(getComputedStyle(blockKeyword).color).toBe('rgb(207, 34, 46)');
    expect(getComputedStyle(blockString).color).toBe('rgb(10, 48, 105)');
    expect(getComputedStyle(document.querySelector<HTMLElement>('#preview pre code')!).color).toBe('rgb(51, 51, 51)');
  });
});
