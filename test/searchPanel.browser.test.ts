/// <reference types="@vitest/browser/providers/playwright" />

import { userEvent } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('VS Code-style document search in Chromium', () => {
  it('keeps CodeMirror document search while presenting a compact themed find widget', async () => {
    document.body.className = 'vscode-dark';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///search-browser.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text: ['# Search', '', 'alpha beta alpha', '', 'Alpha'].join('\n'), locale: 'en',
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
        schemaVersion: 2, sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: false,
      }),
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    await import('../src/webview/main.js');
    await settle();

    const content = document.querySelector<HTMLElement>('.cm-content')!;
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}f{/Control}');
    await settle();

    const panel = document.querySelector<HTMLElement>('.cm-panel.cm-search')!;
    const panels = panel.parentElement!;
    const search = panel.querySelector<HTMLInputElement>('input[name=search]')!;
    expect(panel).not.toBeNull();
    expect(getComputedStyle(panels).position).toBe('absolute');
    expect(getComputedStyle(panel).display).toBe('grid');
    expect(getComputedStyle(panel).backgroundColor).toBe('rgb(243, 243, 243)');
    expect(getComputedStyle(panel).boxShadow).not.toBe('none');
    expect(getComputedStyle(search).height).toBe('24px');

    await userEvent.keyboard('alpha');
    await settle();
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(3);

    const caseToggle = panel.querySelector<HTMLInputElement>('input[name=case]')!;
    await userEvent.click(caseToggle.closest('label')!);
    await settle();
    expect(caseToggle.checked).toBe(true);
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(2);

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();
    expect(getComputedStyle(panel).backgroundColor).toBe('rgb(37, 37, 38)');

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(document.querySelector('.cm-panel.cm-search')).toBeNull();
  });
});
