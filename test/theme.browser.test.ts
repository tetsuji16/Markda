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
      version: 1, text: ['# Theme', '', '> Quoted text', '', 'Use `inline code`.'].join('\n'),
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
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    expect(root.dataset.markdaColorMode).toBe('light');
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(document.body).color).toBe('rgb(26, 26, 26)');
    expect(getComputedStyle(quote).color).toBe('rgb(87, 96, 106)');
    expect(getComputedStyle(inlineCode).backgroundColor).toBe('rgb(246, 248, 250)');
    expect(getComputedStyle(scroller).scrollbarColor).toContain('rgba(31, 35, 40, 0.28)');

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();

    expect(root.dataset.markdaColorMode).toBe('dark');
    expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(30, 30, 30)');
    expect(getComputedStyle(document.body).color).toBe('rgb(212, 212, 212)');
    expect(getComputedStyle(quote).color).toBe('rgb(168, 168, 168)');
    expect(getComputedStyle(inlineCode).backgroundColor).toBe('rgb(37, 37, 38)');
    expect(getComputedStyle(scroller).scrollbarColor).toContain('rgba(200, 200, 200, 0.4)');
  });
});
